import { z } from 'zod';
import mongoose from 'mongoose';
import { Attempt } from '../models/Attempt.js';
import { Question } from '../models/Question.js';
import { Topic } from '../models/Topic.js';
import { Chapter } from '../models/Chapter.js';
import { Progress } from '../models/Progress.js';
import { Mistake } from '../models/Mistake.js';
import { EXAMS, MIN_MCQ, SUBMIT_GRACE_SEC, GATING } from '../config/exams.js';
import { aiAvailable } from '../services/ai/index.js';
import { checkBadges } from '../services/badges.js';
import { applyDraft, bankFilter, deadlineOf, finalizeAttempt, pickQuestions, rescoreAttempt } from '../services/exam.js';
import { AppError, badRequest, notFound } from '../utils/AppError.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'আইডি সঠিক নয়');
const draftShape = {
  mcq: z.record(z.string(), z.number().int().min(0).max(3).nullable()).optional(),
  cq: z.record(z.string(), z.array(z.string().max(5000)).max(4)).optional(),
};

export const startSchema = z.object({
  kind: z.enum(['topic', 'chapter', 'full']),
  topicId: objectId.optional(),
  chapterId: objectId.optional(),
});
export const draftSchema = z.object(draftShape);
export const pickSchema = z.object({ picked: z.number().int().min(0).max(3) });
export const selfMarkSchema = z.object({ scores: z.array(z.number().int().min(0).max(4)).length(4) });
export const historyQuery = z.object({
  kind: z.enum(['topic', 'chapter', 'full']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const bnDigits = (v) => String(v).replace(/d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
const lockedErr = (msg) => new AppError(403, msg, 'TEST_LOCKED');
const paywall = () => new AppError(402, 'পরীক্ষা দিতে প্রিমিয়াম প্যাকেজ প্রয়োজন', 'PAYMENT_REQUIRED');

async function loadOwnAttempt(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('পরীক্ষাটি পাওয়া যায়নি');
  const attempt = await Attempt.findOne({ _id: req.params.id, user: req.user._id });
  if (!attempt) throw notFound('পরীক্ষাটি পাওয়া যায়নি');
  return attempt;
}

/** Shape sent to the client. Answers/explanations appear only for revealed (instant) or submitted questions. */
async function attemptView(attempt) {
  const ids = [...attempt.mcq, ...attempt.cq].map((a) => a.question);
  const questions = await Question.find({ _id: { $in: ids } });
  const qmap = new Map(questions.map((q) => [String(q._id), q]));
  const done = attempt.status === 'submitted';

  const mcq = attempt.mcq
    .filter((a) => qmap.has(String(a.question)))
    .map((a) => {
      const q = qmap.get(String(a.question));
      const reveal = done || a.locked;
      return {
        ...q.toPublic(),
        picked: a.picked,
        locked: a.locked,
        ...(reveal && { correct: a.correct, answer: q.answer, explain: q.explain, why: q.why }),
      };
    });

  const cq = attempt.cq
    .filter((a) => qmap.has(String(a.question)))
    .map((a) => {
      const q = qmap.get(String(a.question));
      return {
        ...q.toPublic(),
        grading: a.grading,
        error: a.error,
        parts: q.parts.map((p, i) => {
          const ans = a.parts[i] ?? {};
          return {
            q: p.q,
            marks: p.marks,
            text: ans.text ?? '',
            ...(done && { score: ans.score, feedback: ans.feedback, missing: ans.missing, answer: p.answer, rubric: p.rubric }),
          };
        }),
      };
    });

  let breakdown;
  if (done) {
    const topicIds = [...new Set(questions.map((q) => String(q.topic ?? '')).filter(Boolean))];
    const topics = await Topic.find({ _id: { $in: topicIds } }).select('title slug chapterNumber chapter').populate('chapter', 'slug').lean();
    const tmap = new Map(topics.map((t) => [String(t._id), t]));
    const rows = new Map();
    for (const m of mcq) {
      const key = String(m.topic ?? '');
      const row = rows.get(key) ?? { topic: tmap.get(key) ?? null, correct: 0, total: 0 };
      row.total += 1;
      if (m.correct) row.correct += 1;
      rows.set(key, row);
    }
    breakdown = [...rows.values()].sort((a, b) => a.correct / a.total - b.correct / b.total);
  }

  const [chapter, topic] = await Promise.all([
    attempt.chapter ? Chapter.findById(attempt.chapter).select('number slug title').lean() : null,
    attempt.topic ? Topic.findById(attempt.topic).select('slug title order').lean() : null,
  ]);

  return {
    _id: attempt._id,
    kind: attempt.kind,
    title: attempt.title,
    instant: attempt.instant,
    cqChoose: attempt.cqChoose,
    status: attempt.status,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    durationSec: attempt.durationSec,
    deadline: deadlineOf(attempt),
    serverNow: new Date(),
    score: attempt.score,
    xpAwarded: attempt.xpAwarded,
    chapter,
    topic,
    mcq,
    cq,
    breakdown,
  };
}

/** POST /exams/attempts — start a new attempt, or resume the unfinished one for the same scope. */
export async function start(req, res) {
  const { kind, topicId, chapterId } = req.body;
  const user = req.user;
  const access = user.accessInfo().hasAccess;
  const template = EXAMS[kind];
  let topic;
  let chapter;
  let scopeKey;
  let title = template.title;

  if (kind === 'topic') {
    if (!topicId) throw badRequest('টপিক নির্বাচন করো');
    topic = await Topic.findById(topicId).select('chapter title published isFree').lean();
    if (!topic?.published) throw notFound('টপিকটি পাওয়া যায়নি');
    if (!topic.isFree && !access) throw paywall();
    if (GATING.topicQuiz) {
      const p = await Progress.findOne({ user: user._id, topic: topic._id }).select('status').lean();
      if (p?.status !== 'completed') throw lockedErr('কুইজ দেওয়ার আগে টপিকটি পড়ে "পড়া শেষ" চাপো');
    }
    chapter = { _id: topic.chapter };
    scopeKey = `topic:${topic._id}`;
    title = `${template.title}: ${topic.title}`;
  } else {
    if (!access) throw paywall();
    if (kind === 'chapter') {
      if (!chapterId) throw badRequest('অধ্যায় নির্বাচন করো');
      chapter = await Chapter.findById(chapterId).select('number title').lean();
      if (!chapter) throw notFound('অধ্যায়টি পাওয়া যায়নি');
      if (GATING.chapterTest) {
        const published = await Topic.countDocuments({ chapter: chapter._id, published: true });
        const done = await Progress.countDocuments({ user: user._id, chapter: chapter._id, status: 'completed' });
        if (done < published) throw lockedErr(`অধ্যায় পরীক্ষার আগে সব টপিক শেষ করো (${bnDigits(published - done)}টি বাকি)`);
      }
      scopeKey = `chapter:${chapter._id}`;
      title = `অধ্যায় ${bnDigits(chapter.number)} — ${template.title}`;
    } else {
      scopeKey = 'full';
    }
  }

  // Resume an unfinished attempt (unless its time is over — then close it first).
  const open = await Attempt.findOne({ user: user._id, scopeKey, status: 'in_progress' });
  if (open) {
    const deadline = deadlineOf(open);
    if (!deadline || Date.now() < deadline.getTime()) return res.json({ attempt: await attemptView(open), resumed: true });
    await finalizeAttempt(open, user);
  }

  const picked = await pickQuestions(kind, { topic, chapter });
  if (picked.mcq.length < MIN_MCQ[kind]) {
    throw new AppError(409, 'এই পরীক্ষার জন্য পর্যাপ্ত প্রশ্ন এখনো যোগ করা হয়নি। শীঘ্রই আসছে!', 'NOT_ENOUGH_QUESTIONS');
  }
  const cqDocs = await Question.find({ _id: { $in: picked.cq.map((q) => q._id) } }).select('parts').lean();
  const partsOf = new Map(cqDocs.map((q) => [String(q._id), q.parts]));

  const attempt = await Attempt.create({
    user: user._id,
    kind,
    scopeKey,
    chapter: chapter?._id,
    topic: topic?._id,
    title,
    instant: template.instant,
    cqChoose: Math.min(template.cqChoose, picked.cq.length),
    timeLimitSec: template.timeLimitMin ? template.timeLimitMin * 60 : null,
    mcq: picked.mcq.map((q) => ({ question: q._id })),
    cq: picked.cq.map((q) => ({ question: q._id, parts: partsOf.get(String(q._id)).map((p) => ({ max: p.marks })) })),
  });

  res.status(201).json({ attempt: await attemptView(attempt), resumed: false });
}

export async function get(req, res) {
  const attempt = await loadOwnAttempt(req);
  res.json({ attempt: await attemptView(attempt) });
}

/** PATCH /exams/attempts/:id/answers — autosave drafts while the test runs. */
export async function saveDraft(req, res) {
  const attempt = await loadOwnAttempt(req);
  if (attempt.status !== 'in_progress') throw badRequest('পরীক্ষাটি ইতিমধ্যে জমা হয়েছে', 'ALREADY_SUBMITTED');
  applyDraft(attempt, req.body);
  await attempt.save();
  res.json({ ok: true, savedAt: new Date() });
}

/** POST /exams/attempts/:id/mcq/:questionId — instant mode: lock one answer and reveal it. */
export async function answerMcq(req, res) {
  const attempt = await loadOwnAttempt(req);
  if (!attempt.instant) throw badRequest('এই পরীক্ষায় উত্তর জমা দেওয়ার পর দেখা যাবে');
  if (attempt.status !== 'in_progress') throw badRequest('পরীক্ষাটি ইতিমধ্যে জমা হয়েছে', 'ALREADY_SUBMITTED');
  const slot = attempt.mcq.find((a) => String(a.question) === req.params.questionId);
  if (!slot) throw notFound('প্রশ্নটি এই পরীক্ষায় নেই');

  const q = await Question.findById(slot.question).select('answer explain why');
  if (!slot.locked) {
    slot.picked = req.body.picked;
    slot.correct = req.body.picked === q.answer;
    slot.locked = true;
    await attempt.save();
  }
  res.json({ picked: slot.picked, correct: slot.correct, answer: q.answer, explain: q.explain, why: q.why });
}

/** POST /exams/attempts/:id/submit — final answers in body (optional), grade everything. */
export async function submit(req, res) {
  const attempt = await loadOwnAttempt(req);
  if (attempt.status === 'submitted') return res.json({ attempt: await attemptView(attempt), xp: 0 });

  const deadline = deadlineOf(attempt);
  const late = deadline && Date.now() > deadline.getTime() + SUBMIT_GRACE_SEC * 1000;
  if (!late) applyDraft(attempt, req.body); // after the deadline only autosaved answers count

  const { xp, previousBest } = await finalizeAttempt(attempt, req.user);
  res.json({ attempt: await attemptView(attempt), xp, previousBest, user: req.user.toPublic() });
}

/** POST /exams/attempts/:id/cq/:questionId/self — student marks a CQ against the model answer (when AI is unavailable). */
export async function selfMark(req, res) {
  const attempt = await loadOwnAttempt(req);
  if (attempt.status !== 'submitted') throw badRequest('আগে পরীক্ষা জমা দাও');
  const slot = attempt.cq.find((a) => String(a.question) === req.params.questionId);
  if (!slot) throw notFound('প্রশ্নটি এই পরীক্ষায় নেই');
  if (slot.grading !== 'self') throw badRequest('এই প্রশ্নটি ইতিমধ্যে মূল্যায়িত');

  slot.parts.forEach((p, i) => {
    p.score = p.text.trim() ? Math.min(p.max, req.body.scores[i]) : 0;
  });
  const xp = await rescoreAttempt(attempt, req.user);
  res.json({ attempt: await attemptView(attempt), xp, user: req.user.toPublic() });
}

export async function history(req, res) {
  const { kind, limit } = req.validatedQuery;
  const attempts = await Attempt.find({ user: req.user._id, ...(kind && { kind }) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('kind title status score xpAwarded startedAt submittedAt durationSec chapter topic')
    .lean();
  res.json({ attempts });
}

/** GET /exams/overview — exam hub: chapter tests (lock state, best score), full test, mistakes, recent attempts. */
export async function overview(req, res) {
  const user = req.user;
  const filter = await bankFilter();
  const [chapters, bank, topicTotals, done, bests, mistakes, recent] = await Promise.all([
    Chapter.find({ published: true }).select('number slug title icon color priority').sort({ number: 1 }).lean(),
    Question.aggregate([{ $match: filter }, { $group: { _id: { chapter: '$chapter', type: '$type' }, n: { $sum: 1 } } }]),
    Topic.aggregate([{ $match: { published: true } }, { $group: { _id: '$chapter', n: { $sum: 1 } } }]),
    Progress.aggregate([{ $match: { user: user._id, status: 'completed' } }, { $group: { _id: '$chapter', n: { $sum: 1 } } }]),
    Attempt.aggregate([
      { $match: { user: user._id, status: 'submitted', kind: { $in: ['chapter', 'full'] } } },
      { $group: { _id: '$scopeKey', best: { $max: '$score.percent' }, attempts: { $sum: 1 } } },
    ]),
    Mistake.countDocuments({ user: user._id, resolved: false }),
    Attempt.find({ user: user._id }).sort({ createdAt: -1 }).limit(8).select('kind title status score xpAwarded submittedAt startedAt').lean(),
  ]);

  const count = (chapterId, type) => bank.find((b) => String(b._id.chapter) === String(chapterId) && b._id.type === type)?.n ?? 0;
  const mapOf = (rows) => new Map(rows.map((r) => [String(r._id), r]));
  const totals = mapOf(topicTotals);
  const doneMap = mapOf(done);
  const bestMap = mapOf(bests);
  const totalMcq = bank.filter((b) => b._id.type === 'mcq').reduce((s, b) => s + b.n, 0);

  res.json({
    access: user.accessInfo().hasAccess,
    aiGrading: aiAvailable(),
    templates: EXAMS,
    chapters: chapters.map((c) => {
      const published = totals.get(String(c._id))?.n ?? 0;
      const completed = doneMap.get(String(c._id))?.n ?? 0;
      const mcq = count(c._id, 'mcq');
      const best = bestMap.get(`chapter:${c._id}`);
      return {
        ...c,
        mcqCount: mcq,
        cqCount: count(c._id, 'cq'),
        topicsPublished: published,
        topicsCompleted: completed,
        ready: mcq >= MIN_MCQ.chapter,
        unlocked: !GATING.chapterTest || (published > 0 && completed >= published),
        best: best?.best ?? null,
        attempts: best?.attempts ?? 0,
      };
    }),
    full: { mcqCount: totalMcq, ready: totalMcq >= MIN_MCQ.full, best: bestMap.get('full')?.best ?? null, attempts: bestMap.get('full')?.attempts ?? 0 },
    mistakes,
    recent,
  });
}

/** GET /exams/mistakes — unresolved wrong MCQs with full explanations. */
export async function listMistakes(req, res) {
  const rows = await Mistake.find({ user: req.user._id, resolved: false }).sort({ lastWrongAt: -1 }).limit(200).populate('question').lean();
  const resolvedCount = await Mistake.countDocuments({ user: req.user._id, resolved: true });
  res.json({
    resolvedCount,
    mistakes: rows
      .filter((m) => m.question)
      .map((m) => ({
        _id: m._id,
        wrongCount: m.wrongCount,
        rightStreak: m.rightStreak,
        lastPicked: m.lastPicked,
        lastWrongAt: m.lastWrongAt,
        chapterNumber: m.chapterNumber,
        question: { _id: m.question._id, q: m.question.q, stimulus: m.question.stimulus, options: m.question.options },
      })),
  });
}

/** POST /exams/mistakes/:id/retry — answer a mistake again; two right in a row clears it. */
export async function retryMistake(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound();
  const m = await Mistake.findOne({ _id: req.params.id, user: req.user._id });
  if (!m) throw notFound();
  const q = await Question.findById(m.question).select('answer explain why');
  const correct = req.body.picked === q.answer;
  if (correct) {
    m.rightStreak += 1;
    m.resolved = m.rightStreak >= 2;
  } else {
    m.rightStreak = 0;
    m.wrongCount += 1;
    m.lastPicked = req.body.picked;
    m.lastWrongAt = new Date();
  }
  await m.save();
  if (m.resolved && (await checkBadges(req.user)).length) await req.user.save();
  res.json({ correct, answer: q.answer, explain: q.explain, why: q.why, rightStreak: m.rightStreak, resolved: m.resolved });
}
