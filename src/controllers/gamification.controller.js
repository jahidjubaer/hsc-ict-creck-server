import { z } from 'zod';
import { User } from '../models/User.js';
import { DailyActivity } from '../models/DailyActivity.js';
import { weekKey } from '../services/activity.js';
import { badgeOverview } from '../services/badges.js';
import { levelInfo } from '../config/gamification.js';
import { escapeRegex } from '../utils/regex.js';
import { addDays, dhakaDay } from '../utils/dates.js';

const LIMIT = 50;

export const leaderboardQuery = z.object({
  period: z.enum(['week', 'all']).default('week'),
  scope: z.enum(['all', 'college', 'district']).default('all'),
});

/** Monday 00:00 Bangladesh time after today (weekly XP resets then — ISO weeks, same as weekKey()). */
function weekEndsAt() {
  const today = dhakaDay();
  const d = new Date(`${today}T00:00:00+06:00`);
  const isoDay = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
  return addDays(d, 8 - isoDay);
}

/** GET /leaderboard — top students by weekly or all-time XP, optionally only my college / district. */
export async function leaderboard(req, res) {
  const { period, scope } = req.validatedQuery;
  const me = req.user;
  const field = period === 'week' ? 'weeklyXp' : 'xp';
  const wk = weekKey();

  const where = { role: 'student', 'settings.showOnLeaderboard': { $ne: false } };
  if (period === 'week') where.weekKey = wk;
  const scopeValue = scope === 'all' ? null : me[scope]?.trim();
  if (scope !== 'all') {
    if (!scopeValue) return res.json({ entries: [], me: null, needsProfile: scope, period, scope, weekEndsAt: weekEndsAt() });
    where[scope] = new RegExp(`^\\s*${escapeRegex(scopeValue)}\\s*$`, 'i');
  }

  const rows = await User.find({ ...where, [field]: { $gt: 0 } })
    .sort({ [field]: -1, updatedAt: 1 })
    .limit(LIMIT)
    .select(`name college district xp weeklyXp streak ${field}`)
    .lean();

  // Competition ranking: equal XP shares a rank (1, 2, 2, 4).
  let rank = 0;
  const entries = rows.map((u, i) => {
    if (i === 0 || u[field] !== rows[i - 1][field]) rank = i + 1;
    return {
      rank,
      id: String(u._id),
      name: u.name,
      college: u.college,
      district: u.district,
      level: levelInfo(u.xp).level,
      score: u[field],
      streak: u.streak?.current ?? 0,
      me: String(u._id) === me.id,
    };
  });

  const myScore = period === 'week' ? (me.weekKey === wk ? me.weeklyXp : 0) : me.xp;
  const hidden = me.settings?.showOnLeaderboard === false || me.role !== 'student';
  const myRank = hidden || myScore <= 0 ? null : (await User.countDocuments({ ...where, [field]: { $gt: myScore } })) + 1;
  const total = await User.countDocuments({ ...where, [field]: { $gt: 0 } });

  res.json({ entries, me: { rank: myRank, score: myScore, hidden }, total, period, scope, scopeValue, weekEndsAt: weekEndsAt() });
}

/** GET /badges — every badge with earned date or progress. */
export async function badges(req, res) {
  res.json({ badges: await badgeOverview(req.user) });
}

export const activityQuery = z.object({ days: z.coerce.number().int().min(7).max(371).default(182) });

/** GET /stats/activity — one entry per day (oldest first) for the heatmap, plus totals. */
export async function activity(req, res) {
  const { days } = req.validatedQuery;
  const from = dhakaDay(addDays(new Date(), -(days - 1)));
  const docs = await DailyActivity.find({ user: req.user._id, day: { $gte: from } }).select('day xp seconds topicsCompleted quizzes').lean();
  const byDay = new Map(docs.map((d) => [d.day, d]));
  const list = Array.from({ length: days }, (_, i) => {
    const day = dhakaDay(addDays(new Date(), i - (days - 1)));
    const a = byDay.get(day);
    return { day, minutes: Math.round((a?.seconds ?? 0) / 60), xp: a?.xp ?? 0, topics: a?.topicsCompleted ?? 0, quizzes: a?.quizzes ?? 0 };
  });
  const active = list.filter((d) => d.minutes > 0 || d.xp > 0);
  res.json({
    days: list,
    totals: {
      activeDays: active.length,
      minutes: list.reduce((s, d) => s + d.minutes, 0),
      xp: list.reduce((s, d) => s + d.xp, 0),
      bestDay: active.reduce((b, d) => (d.minutes > (b?.minutes ?? -1) ? d : b), null),
    },
    goalMinutes: req.user.settings?.dailyGoalMinutes ?? 30,
  });
}
