import { z } from 'zod';
import mongoose from 'mongoose';
import { Attempt } from '../models/Attempt.js';
import { Question } from '../models/Question.js';
import { Chapter } from '../models/Chapter.js';
import { Topic } from '../models/Topic.js';
import { User } from '../models/User.js';
import { logAdmin } from '../models/AdminLog.js';
import { rescoreAttempt } from '../services/exam.js';
import { CQ_PART_MARKS } from '../config/exams.js';
import { escapeRegex } from '../utils/regex.js';
import { badRequest, notFound } from '../utils/AppError.js';
import { PAGE, pageParam } from './admin.controller.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'আইডি সঠিক নয়');

/** GET /admin/meta — chapters with their topics, for filters. */
export async function meta(_req, res) {
  const [chapters, topics] = await Promise.all([
    Chapter.find().select('number title').sort({ number: 1 }).lean(),
    Topic.find().select('chapter slug title order').sort({ order: 1 }).lean(),
  ]);
  res.json({
    chapters: chapters.map((c) => ({
      ...c,
      topics: topics.filter((t) => String(t.chapter) === String(c._id)).map(({ _id, slug, title }) => ({ _id, slug, title })),
    })),
  });
}

// ---------------------------------------------------------------- AI grading review

export const aiListQuery = z.object({
  review: z.enum(['unreviewed', 'bad', 'ok', 'all']).default('unreviewed'),
  chapter: z.coerce.number().int().min(1).max(6).optional(),
  page: pageParam,
});

/** GET /admin/ai-gradings — one row per AI-graded CQ answer, newest first. */
export async function listAiGradings(req, res) {
  const { review, chapter, page } = req.validatedQuery;
  const cqMatch = { 'cq.grading': 'ai' };
  if (review === 'unreviewed') cqMatch['cq.review.verdict'] = { $exists: false };
  if (review === 'bad' || review === 'ok') cqMatch['cq.review.verdict'] = review;

  const pipeline = [
    { $match: { status: 'submitted', 'cq.grading': 'ai' } },
    { $unwind: '$cq' },
    { $match: cqMatch },
    { $lookup: { from: 'questions', localField: 'cq.question', foreignField: '_id', as: 'q' } },
    { $unwind: '$q' },
    ...(chapter ? [{ $match: { 'q.chapterNumber': chapter } }] : []),
    { $sort: { submittedAt: -1 } },
    {
      $facet: {
        items: [{ $skip: (page - 1) * PAGE }, { $limit: PAGE }],
        total: [{ $count: 'n' }],
      },
    },
  ];
  const [{ items, total }] = await Attempt.aggregate(pipeline);
  const users = new Map(
    (await User.find({ _id: { $in: items.map((i) => i.user) } }).select('name email').lean()).map((u) => [String(u._id), u])
  );

  res.json({
    items: items.map((i) => ({
      attemptId: i._id,
      questionId: i.q._id,
      key: i.q.key,
      chapterNumber: i.q.chapterNumber,
      title: i.title,
      kind: i.kind,
      submittedAt: i.submittedAt,
      user: users.get(String(i.user)) ?? null,
      model: i.cq.model,
      review: i.cq.review ?? null,
      stimulus: i.q.stimulus,
      parts: i.q.parts.map((p, n) => {
        const a = i.cq.parts[n] ?? {};
        return { q: p.q, marks: p.marks, answer: p.answer, rubric: p.rubric, text: a.text ?? '', score: a.score, feedback: a.feedback, missing: a.missing };
      }),
    })),
    total: total[0]?.n ?? 0,
    pageSize: PAGE,
  });
}

export const reviewSchema = z.object({
  verdict: z.enum(['ok', 'bad']),
  note: z.string().trim().max(500).optional(),
  scores: z.array(z.number().int().min(0).max(4)).length(4).optional(), // corrected part scores
});

/** POST /admin/ai-gradings/:attemptId/:questionId — mark an AI grade ok/bad, optionally correct the scores. */
export async function reviewAiGrading(req, res) {
  const { attemptId, questionId } = req.params;
  if (!mongoose.isValidObjectId(attemptId) || !mongoose.isValidObjectId(questionId)) throw notFound();
  const attempt = await Attempt.findById(attemptId);
  const slot = attempt?.cq.find((a) => String(a.question) === questionId);
  if (!slot || slot.grading !== 'ai') throw notFound('AI-মূল্যায়িত উত্তরটি পাওয়া যায়নি');

  const { verdict, note, scores } = req.body;
  const before = slot.parts.map((p) => p.score ?? 0);
  const review = { verdict, note, originalScores: slot.review?.originalScores ?? before, by: req.user._id, at: new Date() };
  let changed = false;
  if (scores) {
    slot.parts.forEach((p, i) => {
      const next = p.text.trim() ? Math.min(p.max, scores[i]) : 0;
      if (next !== p.score) changed = true;
      p.score = next;
    });
  }
  slot.review = review;

  if (changed) {
    const owner = await User.findById(attempt.user);
    if (owner) await rescoreAttempt(attempt, owner);
    else await attempt.save();
  } else {
    await attempt.save();
  }
  await logAdmin(req, 'ai.review', {
    user: attempt.user,
    ref: attempt._id,
    details: { questionId, verdict, note, ...(changed && { from: before, to: slot.parts.map((p) => p.score) }) },
  });
  res.json({ review: slot.review, scores: slot.parts.map((p) => p.score), percent: attempt.score.percent });
}

// ---------------------------------------------------------------- questions

export const questionListQuery = z.object({
  chapter: z.coerce.number().int().min(1).max(6).optional(),
  topic: objectId.optional(),
  type: z.enum(['mcq', 'cq']).optional(),
  q: z.string().trim().max(100).optional(),
  edited: z.enum(['1']).optional(),
  inactive: z.enum(['1']).optional(),
  page: pageParam,
});

/** GET /admin/questions */
export async function listQuestions(req, res) {
  const { chapter, topic, type, q, edited, inactive, page } = req.validatedQuery;
  const where = { active: !inactive };
  if (chapter) where.chapterNumber = chapter;
  if (topic) where.topic = topic;
  if (type) where.type = type;
  if (edited) where['adminEdit.at'] = { $exists: true };
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    where.$or = [{ key: rx }, { q: rx }, { stimulus: rx }, { options: rx }, { 'parts.q': rx }];
  }
  const [questions, total] = await Promise.all([
    Question.find(where)
      .select('key type chapterNumber topic difficulty source q stimulus options answer parts.q active adminEdit')
      .sort({ key: 1 })
      .skip((page - 1) * PAGE)
      .limit(PAGE)
      .lean(),
    Question.countDocuments(where),
  ]);
  res.json({ questions, total, pageSize: PAGE });
}

/** GET /admin/questions/:id — everything, including answers. */
export async function getQuestion(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('প্রশ্নটি পাওয়া যায়নি');
  const question = await Question.findById(req.params.id).populate('adminEdit.by', 'name').lean();
  if (!question) throw notFound('প্রশ্নটি পাওয়া যায়নি');
  res.json({ question });
}

const text = (max = 4000) => z.string().trim().min(1, 'খালি রাখা যাবে না').max(max);
const optionalText = (max = 4000) => z.string().trim().max(max).optional();
const common = {
  difficulty: z.enum(['easy', 'medium', 'hard']),
  active: z.boolean(),
  stimulus: optionalText(),
};
const mcqEdit = z.object({
  ...common,
  q: text(),
  options: z.array(text(1000)).length(4),
  answer: z.number().int().min(0).max(3),
  explain: text(),
  why: z.array(z.string().trim().max(1000)).length(4).optional(),
});
const cqEdit = z.object({
  ...common,
  stimulus: text(),
  parts: z
    .array(z.object({ q: text(1000), answer: text(6000), rubric: z.array(z.string().trim().min(1).max(500)).max(12).default([]) }))
    .length(4),
});

/** PATCH /admin/questions/:id — fix a typo / answer key from the browser. */
export async function updateQuestion(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('প্রশ্নটি পাওয়া যায়নি');
  const question = await Question.findById(req.params.id);
  if (!question) throw notFound('প্রশ্নটি পাওয়া যায়নি');

  const parsed = (question.type === 'mcq' ? mcqEdit : cqEdit).safeParse(req.body);
  if (!parsed.success) {
    const err = badRequest('ইনপুট সঠিক নয়', 'VALIDATION_ERROR');
    err.details = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw err;
  }
  const data = parsed.data;
  const changed = [];
  const set = (field, value) => {
    if (JSON.stringify(question[field] ?? null) !== JSON.stringify(value ?? null)) changed.push(field);
    question[field] = value;
  };

  set('difficulty', data.difficulty);
  set('active', data.active);
  set('stimulus', data.stimulus || undefined);
  if (question.type === 'mcq') {
    set('q', data.q);
    set('options', data.options);
    set('answer', data.answer);
    set('explain', data.explain);
    set('why', data.why?.some(Boolean) ? data.why : undefined);
  } else {
    const before = JSON.stringify(question.parts.map((p) => ({ q: p.q, answer: p.answer, rubric: p.rubric })));
    const parts = data.parts.map((p, i) => ({ ...p, marks: CQ_PART_MARKS[i] }));
    if (before !== JSON.stringify(data.parts)) changed.push('parts');
    question.parts = parts;
  }
  if (!changed.length) return res.json({ question, changed });

  question.adminEdit = { at: new Date(), by: req.user._id };
  await question.save();
  await logAdmin(req, 'question.edit', { ref: question._id, details: { key: question.key, changed } });
  res.json({ question, changed });
}
