// Tests on free topics for visitors who haven't signed in. Nothing is stored: the start call returns the
// questions plus a signed token naming exactly those questions; the check call grades MCQs and reveals answers.
// CQ is self-check against the model answer — AI grading (it costs quota) needs an account.
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { EXAMS } from '../config/exams.js';
import { Question } from '../models/Question.js';
import { Topic } from '../models/Topic.js';
import { AppError, badRequest, notFound } from '../utils/AppError.js';
import { pickQuestions } from '../services/exam.js';

const TOKEN_TTL = '3h';
const AUDIENCE = 'guest-quiz';
const KIND = { mcq: 'topic', cq: 'topic-cq' };

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'আইডি সঠিক নয়');
export const startSchema = z.object({ topicId: objectId, part: z.enum(['mcq', 'cq']) });
export const checkSchema = z.object({
  token: z.string().min(10).max(4000),
  mcq: z.record(z.string(), z.number().int().min(0).max(3).nullable()).optional(),
});

/** POST /guest/quiz — questions for a free topic's MCQ quiz or CQ test. */
export async function start(req, res) {
  const { topicId, part } = req.body;
  const topic = await Topic.findById(topicId).select('chapter slug title published isFree').populate('chapter', 'slug number').lean();
  if (!topic?.published) throw notFound('টপিকটি পাওয়া যায়নি');
  if (!topic.isFree) throw new AppError(401, 'এই পরীক্ষা দিতে লগইন করো — নতুন অ্যাকাউন্টে ১৫ দিন সব ফ্রি', 'LOGIN_REQUIRED');

  const kind = KIND[part];
  const picked = await pickQuestions(kind, { topic });
  const ids = [...picked.mcq, ...picked.cq].map((q) => String(q._id));
  if (!ids.length) throw new AppError(409, 'এই টপিকে এই ধরনের প্রশ্ন এখনো নেই', 'NOT_ENOUGH_QUESTIONS');
  const docs = await Question.find({ _id: { $in: ids } });
  const byId = new Map(docs.map((q) => [String(q._id), q]));

  res.status(201).json({
    token: jwt.sign({ topic: String(topic._id), part, ids }, env.JWT_ACCESS_SECRET, { audience: AUDIENCE, expiresIn: TOKEN_TTL }),
    part,
    title: `${EXAMS[kind].title}: ${topic.title}`,
    topic: { _id: topic._id, slug: topic.slug, title: topic.title, chapterSlug: topic.chapter?.slug, chapterNumber: topic.chapter?.number },
    mcq: picked.mcq.map((q) => byId.get(String(q._id)).toPublic()),
    cq: picked.cq.map((q) => byId.get(String(q._id)).toPublic()),
  });
}

/** POST /guest/quiz/check — MCQ score with answers + explanations, CQ model answers and rubric. */
export async function check(req, res) {
  let payload;
  try {
    payload = jwt.verify(req.body.token, env.JWT_ACCESS_SECRET, { audience: AUDIENCE });
  } catch {
    throw badRequest('পরীক্ষার সময় শেষ হয়ে গেছে — আবার শুরু করো', 'QUIZ_EXPIRED');
  }
  const picks = req.body.mcq ?? {};
  const docs = await Question.find({ _id: { $in: payload.ids } });
  const byId = new Map(docs.map((q) => [String(q._id), q]));
  const ordered = payload.ids.map((id) => byId.get(id)).filter(Boolean);

  const mcq = ordered
    .filter((q) => q.type === 'mcq')
    .map((q) => {
      const picked = picks[String(q._id)] ?? null;
      return { ...q.toPublic(), picked, correct: picked !== null && picked === q.answer, answer: q.answer, explain: q.explain, why: q.why };
    });
  const cq = ordered
    .filter((q) => q.type === 'cq')
    .map((q) => ({ ...q.toPublic(), parts: q.parts.map((p) => ({ q: p.q, marks: p.marks, answer: p.answer, rubric: p.rubric })) }));
  const right = mcq.filter((m) => m.correct).length;

  res.json({
    part: payload.part,
    mcq,
    cq,
    score: { mcq: right, mcqTotal: mcq.length, percent: mcq.length ? Math.round((right / mcq.length) * 100) : null },
  });
}

/** GET /guest/free-topics — the free topic of every chapter, with how many MCQ/CQ it has (exam page for visitors). */
export async function freeTopics(_req, res) {
  const topics = await Topic.find({ isFree: true, published: true })
    .select('slug title chapter chapterNumber')
    .populate('chapter', 'slug title icon color number')
    .sort({ chapterNumber: 1 })
    .lean();
  const counts = await Question.aggregate([
    { $match: { active: true, topic: { $in: topics.map((t) => t._id) } } },
    { $group: { _id: { topic: '$topic', type: '$type' }, n: { $sum: 1 } } },
  ]);
  const count = (id, type) => counts.find((c) => String(c._id.topic) === String(id) && c._id.type === type)?.n ?? 0;
  res.json({
    topics: topics.map((t) => ({ _id: t._id, slug: t.slug, title: t.title, chapter: t.chapter, mcqCount: count(t._id, 'mcq'), cqCount: count(t._id, 'cq') })),
  });
}
