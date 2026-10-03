import { z } from 'zod';
import { Topic } from '../models/Topic.js';
import { Chapter } from '../models/Chapter.js';
import { Progress } from '../models/Progress.js';
import { DailyActivity } from '../models/DailyActivity.js';
import { XP, recordActivity } from '../services/activity.js';
import { syncPlanFor } from '../services/studyPlan.js';
import { addDays, dhakaDay } from '../utils/dates.js';
import { notFound } from '../utils/AppError.js';

export const heartbeatSchema = z.object({
  readPercent: z.coerce.number().min(0).max(100),
  seconds: z.coerce.number().int().min(0).max(300).default(0),
});

export const updateSchema = z.object({
  bookmarked: z.boolean().optional(),
  note: z.string().max(5000).optional(),
  highlights: z
    .array(
      z.object({
        block: z.number().int().min(0).max(500),
        start: z.number().int().min(0),
        end: z.number().int().min(1),
        text: z.string().max(1000),
        color: z.enum(['yellow', 'green', 'blue', 'pink']),
      })
    )
    .max(300)
    .optional(),
});

async function loadTopic(id) {
  const topic = await Topic.findById(id).select('chapter published');
  if (!topic || !topic.published) throw notFound('টপিকটি পাওয়া যায়নি');
  return topic;
}

/** Periodic ping from the topic page: reading position + time spent since last ping. */
export async function heartbeat(req, res) {
  const topic = await loadTopic(req.params.topicId);
  const { readPercent, seconds } = req.body;

  const progress = await Progress.findOneAndUpdate(
    { user: req.user._id, topic: topic._id },
    {
      $max: { readPercent: Math.round(readPercent) },
      $inc: { timeSpentSec: seconds },
      $set: { lastSeenAt: new Date() },
      $setOnInsert: { chapter: topic.chapter },
    },
    { upsert: true, returnDocument: 'after' }
  );

  if (seconds > 0) await recordActivity(req.user, { seconds });
  res.json({ progress, streak: req.user.streakInfo() });
}

/** Marks a topic as completed; XP is awarded only the first time. */
export async function complete(req, res) {
  const topic = await loadTopic(req.params.topicId);

  const before = await Progress.findOneAndUpdate(
    { user: req.user._id, topic: topic._id },
    {
      $set: { status: 'completed', readPercent: 100, lastSeenAt: new Date() },
      $setOnInsert: { chapter: topic.chapter, completedAt: new Date() },
    },
    { upsert: true, returnDocument: 'before' }
  );

  const firstTime = !before || before.status !== 'completed';
  if (firstTime) {
    if (before) await Progress.updateOne({ _id: before._id }, { $set: { completedAt: new Date() } });
    await recordActivity(req.user, { xp: XP.TOPIC_COMPLETE, topicsCompleted: 1 });
    await syncPlanFor(req.user);
  }

  res.json({ xpAwarded: firstTime ? XP.TOPIC_COMPLETE : 0, user: req.user.toPublic() });
}

export async function update(req, res) {
  const topic = await loadTopic(req.params.topicId);
  const progress = await Progress.findOneAndUpdate(
    { user: req.user._id, topic: topic._id },
    { $set: req.body, $setOnInsert: { chapter: topic.chapter } },
    { upsert: true, returnDocument: 'after' }
  );
  res.json({ progress });
}

/** Dashboard data: per-chapter progress, continue-reading, bookmarks, last 7 days of activity. */
export async function summary(req, res) {
  const userId = req.user._id;
  const [chapters, totals, done, recent, bookmarks, activity] = await Promise.all([
    Chapter.find({ published: true }).select('number slug title icon color priority').sort({ number: 1 }).lean(),
    Topic.aggregate([{ $match: { published: true } }, { $group: { _id: '$chapter', n: { $sum: 1 } } }]),
    Progress.aggregate([{ $match: { user: userId, status: 'completed' } }, { $group: { _id: '$chapter', n: { $sum: 1 } } }]),
    Progress.find({ user: userId }).sort({ lastSeenAt: -1 }).limit(4).populate('topic', 'slug title chapterNumber').populate('chapter', 'slug').lean(),
    Progress.find({ user: userId, bookmarked: true }).sort({ updatedAt: -1 }).limit(20).populate('topic', 'slug title chapterNumber').populate('chapter', 'slug').lean(),
    DailyActivity.find({ user: userId, day: { $gte: dhakaDay(addDays(new Date(), -6)) } }).lean(),
  ]);

  const totalMap = new Map(totals.map((t) => [String(t._id), t.n]));
  const doneMap = new Map(done.map((d) => [String(d._id), d.n]));
  const byDay = new Map(activity.map((a) => [a.day, a]));
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const day = dhakaDay(addDays(new Date(), i - 6));
    const a = byDay.get(day);
    return { day, xp: a?.xp ?? 0, minutes: Math.round((a?.seconds ?? 0) / 60) };
  });

  const toLink = (p) => p.topic && p.chapter && { slug: p.topic.slug, title: p.topic.title, chapterNumber: p.topic.chapterNumber, chapterSlug: p.chapter.slug, status: p.status, readPercent: p.readPercent };

  res.json({
    chapters: chapters.map((c) => ({
      ...c,
      total: totalMap.get(String(c._id)) ?? 0,
      completed: doneMap.get(String(c._id)) ?? 0,
    })),
    continueReading: recent.filter((p) => p.status !== 'completed').map(toLink).filter(Boolean),
    recent: recent.map(toLink).filter(Boolean),
    bookmarks: bookmarks.map(toLink).filter(Boolean),
    last7,
    user: req.user.toPublic(),
  });
}
