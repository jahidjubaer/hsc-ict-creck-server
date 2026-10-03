import { DailyActivity } from '../models/DailyActivity.js';
import { dayDiff, dhakaDay, dhakaHour } from '../utils/dates.js';
import { STREAK_FREEZE } from '../config/gamification.js';
import { checkBadges } from './badges.js';

export const XP = {
  TOPIC_COMPLETE: 20,
};

/** ISO week key like "2026-W40" (Dhaka date), used for weekly leaderboards. */
export function weekKey(date = new Date()) {
  const [y, m, d] = dhakaDay(date).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Advances the user's streak for today's activity. Returns true the first time it runs on a day. */
function touchStreak(user, today) {
  const s = user.streak;
  if (s.lastActiveDay === today) return false;
  const gap = s.lastActiveDay ? dayDiff(s.lastActiveDay, today) : null;
  if (gap === 1) s.current += 1;
  else if (gap !== null && gap > 1 && s.freezes >= gap - 1) {
    s.freezes -= gap - 1; // spend freezes to cover missed days
    s.current += 1;
  } else s.current = 1;
  s.longest = Math.max(s.longest, s.current);
  s.lastActiveDay = today;
  // Every full week in a row earns a freeze that covers one missed day later.
  if (s.current % STREAK_FREEZE.every === 0 && s.freezes < STREAK_FREEZE.max) s.freezes += 1;
  return true;
}

/**
 * Records learning activity: adds XP, study time and counters for today, updates streak.
 * Mutates and saves `user`. Returns today's activity doc.
 */
export async function recordActivity(user, { xp = 0, seconds = 0, topicsCompleted = 0, quizzes = 0 } = {}) {
  const today = dhakaDay();
  const activity = await DailyActivity.findOneAndUpdate(
    { user: user._id, day: today },
    { $inc: { xp, seconds, topicsCompleted, quizzes } },
    { upsert: true, returnDocument: 'after' }
  );

  const wk = weekKey();
  if (user.weekKey !== wk) {
    user.weekKey = wk;
    user.weeklyXp = 0;
  }
  user.xp += xp;
  user.weeklyXp += xp;
  // Any meaningful action (XP or ≥1 minute of study) keeps the streak alive.
  const newDay = (xp > 0 || activity.seconds >= 60) && touchStreak(user, today);

  // Badges are re-checked only when something they depend on can have changed (not on every reading ping).
  const hour = dhakaHour();
  const flags = { nightOwl: hour < 4, earlyBird: hour >= 4 && hour < 7 };
  const owned = new Set(user.badges.map((b) => b.key));
  const habit = (flags.nightOwl && !owned.has('night-owl')) || (flags.earlyBird && !owned.has('early-bird'));
  if (xp > 0 || topicsCompleted || quizzes || newDay || habit) await checkBadges(user, flags);
  await user.save();
  return activity;
}
