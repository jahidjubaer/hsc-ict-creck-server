import { Chapter } from '../models/Chapter.js';
import { Topic } from '../models/Topic.js';
import { Attempt } from '../models/Attempt.js';
import { Question } from '../models/Question.js';
import { Progress } from '../models/Progress.js';
import { AppError, notFound } from '../utils/AppError.js';

const TOPIC_LIST_FIELDS = 'slug order title summary bookRef estMinutes isFree important published';

const hasAccess = (user) => Boolean(user?.accessInfo().hasAccess);

/** Map of topicId -> progress doc for a user. */
async function progressMap(userId, filter = {}) {
  if (!userId) return new Map();
  const rows = await Progress.find({ user: userId, ...filter }).lean();
  return new Map(rows.map((p) => [String(p.topic), p]));
}

export async function listChapters(req, res) {
  const chapters = await Chapter.find({ published: true }).sort({ number: 1 }).lean();
  const counts = await Topic.aggregate([
    { $group: { _id: '$chapter', total: { $sum: 1 }, published: { $sum: { $cond: ['$published', 1, 0] } } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c]));

  let doneMap = new Map();
  if (req.user) {
    const done = await Progress.aggregate([
      { $match: { user: req.user._id, status: 'completed' } },
      { $group: { _id: '$chapter', n: { $sum: 1 } } },
    ]);
    doneMap = new Map(done.map((d) => [String(d._id), d.n]));
  }

  res.json({
    chapters: chapters.map((c) => ({
      ...c,
      topicCount: countMap.get(String(c._id))?.total ?? 0,
      publishedCount: countMap.get(String(c._id))?.published ?? 0,
      completedCount: doneMap.get(String(c._id)) ?? 0,
    })),
  });
}

export async function getChapter(req, res) {
  const chapter = await Chapter.findOne({ slug: req.params.slug, published: true }).lean();
  if (!chapter) throw notFound('অধ্যায়টি পাওয়া যায়নি');

  const topics = await Topic.find({ chapter: chapter._id }).select(TOPIC_LIST_FIELDS).sort({ order: 1 }).lean();
  const progress = await progressMap(req.user?._id, { chapter: chapter._id });
  const access = hasAccess(req.user);

  res.json({
    chapter,
    access,
    topics: topics.map((t) => {
      const p = progress.get(String(t._id));
      return {
        ...t,
        locked: !t.published || (!t.isFree && !access),
        progress: p ? { status: p.status, readPercent: p.readPercent, bookmarked: p.bookmarked, bestQuizScore: p.bestQuizScore } : null,
      };
    }),
  });
}

export async function getTopic(req, res) {
  const chapter = await Chapter.findOne({ slug: req.params.slug, published: true }).lean();
  if (!chapter) throw notFound('অধ্যায়টি পাওয়া যায়নি');

  const topic = await Topic.findOne({ chapter: chapter._id, slug: req.params.topicSlug }).lean();
  if (!topic) throw notFound('টপিকটি পাওয়া যায়নি');
  if (!topic.published) throw new AppError(404, 'এই টপিকটি শীঘ্রই আসছে', 'COMING_SOON');
  if (!topic.isFree && !hasAccess(req.user)) {
    throw new AppError(402, 'এই টপিক পড়তে প্রিমিয়াম প্যাকেজ প্রয়োজন', 'PAYMENT_REQUIRED');
  }

  const siblings = await Topic.find({ chapter: chapter._id }).select('slug title order published').sort({ order: 1 }).lean();
  const idx = siblings.findIndex((s) => String(s._id) === String(topic._id));

  const [progress, mcqCount, cqCount, cqBest] = await Promise.all([
    Progress.findOneAndUpdate(
      { user: req.user._id, topic: topic._id },
      { $set: { lastSeenAt: new Date() }, $setOnInsert: { chapter: chapter._id } },
      { upsert: true, returnDocument: 'after' }
    ).lean(),
    Question.countDocuments({ active: true, topic: topic._id, type: 'mcq' }),
    Question.countDocuments({ active: true, topic: topic._id, type: 'cq' }),
    Attempt.findOne({ user: req.user._id, scopeKey: `topic-cq:${topic._id}`, status: 'submitted' }).sort({ 'score.percent': -1 }).select('score.percent').lean(),
  ]);

  res.json({
    chapter: { _id: chapter._id, number: chapter.number, slug: chapter.slug, title: chapter.title, color: chapter.color, icon: chapter.icon },
    topic,
    siblings,
    prev: siblings[idx - 1] ?? null,
    next: siblings[idx + 1] ?? null,
    progress,
    // the two topic tests: MCQ quiz (best kept on progress) and CQ practice
    tests: {
      mcq: { count: mcqCount, best: progress?.bestQuizScore ?? null },
      cq: { count: cqCount, best: cqBest?.score?.percent ?? null },
    },
  });
}

