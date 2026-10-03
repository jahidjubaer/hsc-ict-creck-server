import { Progress } from '../models/Progress.js';
import { Topic } from '../models/Topic.js';
import { Chapter } from '../models/Chapter.js';
import { Attempt } from '../models/Attempt.js';
import { Mistake } from '../models/Mistake.js';
import { DailyActivity } from '../models/DailyActivity.js';
import { StudyPlan } from '../models/StudyPlan.js';
import { BADGES, CHAPTER_A_PLUS } from '../config/gamification.js';
import { CHAPTER_TEST_KINDS } from '../config/exams.js';

/** Every number a badge can depend on (see BADGES[].metric). A handful of small indexed queries. */
export async function computeStats(user, flags = {}) {
  const uid = user._id;
  const goalSec = (user.settings?.dailyGoalMinutes ?? 30) * 60;
  const [done, publishedByChapter, chapters, tests, quizzesPerfect, chapterBest, fullBest, mistakesFixed, time, goalDays, plan] = await Promise.all([
    Progress.aggregate([{ $match: { user: uid, status: 'completed' } }, { $group: { _id: '$chapter', n: { $sum: 1 } } }]),
    Topic.aggregate([{ $match: { published: true } }, { $group: { _id: '$chapter', n: { $sum: 1 } } }]),
    Chapter.find().select('number').lean(),
    Attempt.countDocuments({ user: uid, status: 'submitted' }),
    // "Perfect" = every MCQ right (the topic quiz's CQ is graded separately and rarely gets full marks).
    Attempt.distinct('scopeKey', { user: uid, status: 'submitted', kind: 'topic', 'score.mcqTotal': { $gt: 0 }, $expr: { $eq: ['$score.mcq', '$score.mcqTotal'] } }),
    Attempt.aggregate([
      { $match: { user: uid, status: 'submitted', kind: { $in: CHAPTER_TEST_KINDS } } },
      { $group: { _id: '$chapter', best: { $max: '$score.percent' } } },
    ]),
    Attempt.findOne({ user: uid, status: 'submitted', kind: 'full' }).sort({ 'score.percent': -1 }).select('score.percent').lean(),
    Mistake.countDocuments({ user: uid, resolved: true }),
    DailyActivity.aggregate([{ $match: { user: uid } }, { $group: { _id: null, s: { $sum: '$seconds' } } }]),
    DailyActivity.countDocuments({ user: uid, seconds: { $gte: goalSec } }),
    StudyPlan.findOne({ user: uid }).select('bonusDays').lean(),
  ]);

  const doneBy = new Map(done.map((d) => [String(d._id), d.n]));
  const totalBy = new Map(publishedByChapter.map((d) => [String(d._id), d.n]));
  const bestBy = new Map(chapterBest.map((d) => [String(d._id), d.best]));
  const topicsDone = done.reduce((s, d) => s + d.n, 0);
  const topicsTotal = publishedByChapter.reduce((s, d) => s + d.n, 0);

  const stats = {
    streakLongest: user.streak?.longest ?? 0,
    topicsDone,
    topicsTotal,
    topicsLeft0: topicsTotal > 0 && topicsDone >= topicsTotal ? 1 : 0,
    studyHours: Math.floor((time[0]?.s ?? 0) / 3600),
    goalDays,
    testsTaken: tests,
    perfectQuizzes: quizzesPerfect.length,
    chapterAplus: chapterBest.filter((c) => c.best >= CHAPTER_A_PLUS).length,
    fullAplus: (fullBest?.score?.percent ?? 0) >= CHAPTER_A_PLUS ? 1 : 0,
    mistakesFixed,
    planDays: plan?.bonusDays ?? 0,
    xp: user.xp,
    nightOwl: flags.nightOwl ? 1 : 0,
    earlyBird: flags.earlyBird ? 1 : 0,
  };
  for (const c of chapters) {
    const id = String(c._id);
    const all = (totalBy.get(id) ?? 0) > 0 && (doneBy.get(id) ?? 0) >= totalBy.get(id);
    stats[`chapter${c.number}Master`] = all && (bestBy.get(id) ?? 0) >= CHAPTER_A_PLUS ? 1 : 0;
  }
  return stats;
}

/**
 * Awards every badge the user now qualifies for. Mutates `user` (caller saves) and remembers the new ones in
 * `user.$locals.newBadges`, which the auth middleware adds to the JSON response so the app can celebrate.
 */
export async function checkBadges(user, flags = {}) {
  const owned = new Set((user.badges ?? []).map((b) => b.key));
  if (owned.size >= BADGES.length) return [];
  const stats = await computeStats(user, flags);
  const now = new Date();
  const earned = BADGES.filter((b) => !owned.has(b.key) && (stats[b.metric] ?? 0) >= b.target);
  if (!earned.length) return [];
  user.badges.push(...earned.map((b) => ({ key: b.key, at: now })));
  user.$locals.newBadges = [...(user.$locals.newBadges ?? []), ...earned.map(publicBadge)];
  return earned;
}

export const publicBadge = (b) => ({ key: b.key, title: b.title, desc: b.desc, icon: b.icon, tier: b.tier, group: b.group });

/** All badges with earned date or progress toward the target. */
export async function badgeOverview(user) {
  const stats = await computeStats(user);
  const owned = new Map((user.badges ?? []).map((b) => [b.key, b.at]));
  return BADGES.map((b) => {
    // "all topics" is a yes/no metric; show it as topics done / published instead.
    const [value, target] = b.metric === 'topicsLeft0' ? [stats.topicsDone, stats.topicsTotal || 1] : [stats[b.metric] ?? 0, b.target];
    return { ...publicBadge(b), earnedAt: owned.get(b.key) ?? null, progress: Math.min(value, target), target };
  });
}
