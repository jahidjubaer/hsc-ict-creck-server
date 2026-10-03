import { Question } from '../models/Question.js';
import { Topic } from '../models/Topic.js';
import { Attempt } from '../models/Attempt.js';
import { Mistake } from '../models/Mistake.js';
import { Progress } from '../models/Progress.js';
import { Chapter } from '../models/Chapter.js';
import { DailyActivity } from '../models/DailyActivity.js';
import { EXAMS } from '../config/exams.js';
import { env } from '../config/env.js';
import { aiAvailable, gradeCq } from './ai/index.js';
import { recordActivity } from './activity.js';
import { checkBadges } from './badges.js';
import { syncPlanFor } from './studyPlan.js';
import { dhakaDay } from '../utils/dates.js';

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Random sample of n that spreads evenly across groups (topics or chapters), then shuffles. */
export function spreadSample(items, n, groupOf) {
  const groups = new Map();
  for (const it of shuffle(items)) {
    const k = String(groupOf(it) ?? '_');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const queues = shuffle([...groups.values()]);
  const out = [];
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) if (q.length && out.length < n) out.push(q.shift());
  }
  return shuffle(out);
}

/** Mongo filter for active questions whose topic is published (or chapter-level questions). */
export async function bankFilter(extra = {}) {
  const published = await Topic.find({ published: true, ...(extra.chapter && { chapter: extra.chapter }) }).distinct('_id');
  return { active: true, ...extra, $or: [{ topic: null }, { topic: { $in: published } }] };
}

/** Picks questions for a new attempt. */
export async function pickQuestions(kind, { topic, chapter }) {
  const t = EXAMS[kind];
  if (kind === 'topic') {
    const [mcq, cq] = await Promise.all([
      Question.find({ active: true, type: 'mcq', topic: topic._id }).select('_id topic').lean(),
      Question.find({ active: true, type: 'cq', topic: topic._id }).select('_id topic').lean(),
    ]);
    return { mcq: shuffle(mcq).slice(0, t.mcq), cq: shuffle(cq).slice(0, t.cq) };
  }
  const filter = await bankFilter(kind === 'chapter' ? { chapter: chapter._id } : {});
  const [mcq, cq] = await Promise.all([
    Question.find({ ...filter, type: 'mcq' }).select('_id topic chapterNumber').lean(),
    t.cq ? Question.find({ ...filter, type: 'cq' }).select('_id topic chapterNumber').lean() : [],
  ]);
  const groupOf = kind === 'chapter' ? (q) => q.topic : (q) => q.chapterNumber;
  return { mcq: spreadSample(mcq, t.mcq, groupOf), cq: spreadSample(cq, t.cq, groupOf) };
}

export const deadlineOf = (attempt) => (attempt.timeLimitSec ? new Date(attempt.startedAt.getTime() + attempt.timeLimitSec * 1000) : null);

/** Applies draft answers from the client (ignores locked instant-mode MCQs). */
export function applyDraft(attempt, { mcq = {}, cq = {} } = {}) {
  for (const a of attempt.mcq) {
    const id = String(a.question);
    if (a.locked || !(id in mcq)) continue;
    const v = mcq[id];
    a.picked = Number.isInteger(v) && v >= 0 && v <= 3 ? v : null;
  }
  for (const a of attempt.cq) {
    const texts = cq[String(a.question)];
    if (!Array.isArray(texts)) continue;
    a.parts.forEach((p, i) => {
      if (typeof texts[i] === 'string') p.text = texts[i].slice(0, 5000);
    });
  }
}

const pointsFor = (kind, percent) => Math.round(((EXAMS[kind]?.maxXp ?? 0) * percent) / 100);

/** Recomputes the attempt score from its answers. */
export function computeScore(attempt) {
  const mcq = attempt.mcq.filter((a) => a.correct).length;
  const graded = attempt.cq.filter((a) => a.grading !== 'skipped');
  const cq = graded.reduce((s, a) => s + a.parts.reduce((t, p) => t + (p.score ?? 0), 0), 0);
  const perCq = attempt.cq[0]?.parts.reduce((s, p) => s + p.max, 0) ?? 10;
  const cqTotal = Math.min(attempt.cqChoose, attempt.cq.length) * perCq;
  const mcqTotal = attempt.mcq.length;
  const total = mcqTotal + cqTotal;
  attempt.score = {
    mcq,
    mcqTotal,
    cq,
    cqTotal,
    cqPending: graded.some((a) => a.grading === 'self' && a.parts.some((p) => p.score === null)),
    percent: total ? Math.round(((mcq + cq) / total) * 100) : 0,
  };
}

/**
 * XP rewards improvement only: (points for this attempt) − (points of the best earlier attempt on the same scope),
 * minus what this attempt was already given. Stops quiz-repeating from farming XP.
 */
async function awardXp(attempt, user, { countQuiz = false } = {}) {
  const best = await Attempt.findOne({ user: user._id, scopeKey: attempt.scopeKey, status: 'submitted', _id: { $ne: attempt._id } })
    .sort({ 'score.percent': -1 })
    .select('score.percent')
    .lean();
  const target = Math.max(0, pointsFor(attempt.kind, attempt.score.percent) - pointsFor(attempt.kind, best?.score.percent ?? 0));
  const delta = Math.max(0, target - attempt.xpAwarded);
  attempt.xpAwarded += delta;
  if (delta || countQuiz) await recordActivity(user, { xp: delta, quizzes: countQuiz ? 1 : 0 });
  return { delta, previousBest: best?.score.percent ?? null };
}

async function updateMistakes(attempt, user, qmap) {
  const ops = [];
  for (const a of attempt.mcq) {
    if (a.picked === null) continue;
    const q = qmap.get(String(a.question));
    if (a.correct) {
      ops.push({ updateOne: { filter: { user: user._id, question: a.question, resolved: false }, update: { $inc: { rightStreak: 1 } } } });
    } else {
      ops.push({
        updateOne: {
          filter: { user: user._id, question: a.question },
          update: { $inc: { wrongCount: 1 }, $set: { rightStreak: 0, resolved: false, lastPicked: a.picked, lastWrongAt: new Date(), chapterNumber: q?.chapterNumber } },
          upsert: true,
        },
      });
    }
  }
  if (!ops.length) return;
  await Mistake.bulkWrite(ops, { ordered: false });
  await Mistake.updateMany({ user: user._id, resolved: false, rightStreak: { $gte: 2 } }, { $set: { resolved: true } });
}

/** How many more CQs this user may send to the AI examiner today. */
async function aiQuotaLeft(user) {
  const today = await DailyActivity.findOne({ user: user._id, day: dhakaDay() }).select('aiGradings').lean();
  return Math.max(0, env.AI_DAILY_LIMIT - (today?.aiGradings ?? 0));
}

async function gradeCqs(attempt, user, qmap) {
  // The first `cqChoose` attempted CQs count (board rule: answer any N); the rest are marked skipped.
  const answered = attempt.cq.filter((a) => a.parts.some((p) => p.text.trim()));
  const counted = new Set(answered.slice(0, attempt.cqChoose));
  const chapterTitles = new Map((await Chapter.find().select('number title').lean()).map((c) => [c.number, c.title]));
  let quota = aiAvailable() ? await aiQuotaLeft(user) : 0;
  let used = 0;

  await Promise.all(
    attempt.cq.map(async (a) => {
      if (!counted.has(a)) {
        a.grading = 'skipped';
        a.parts.forEach((p) => {
          p.score = 0;
        });
        return;
      }
      const q = qmap.get(String(a.question));
      if (quota <= 0) {
        a.grading = 'self';
        a.error = aiAvailable() ? 'আজকের AI মূল্যায়নের সীমা শেষ' : undefined;
        return;
      }
      quota -= 1;
      used += 1;
      try {
        const res = await gradeCq({ question: q, answers: a.parts.map((p) => p.text), chapterTitle: chapterTitles.get(q.chapterNumber) });
        a.grading = 'ai';
        a.model = res.model;
        res.parts.forEach((g, i) => Object.assign(a.parts[i], g));
      } catch (err) {
        console.error('AI grading failed:', err.message);
        a.grading = 'self';
        a.error = 'AI মূল্যায়ন এই মুহূর্তে করা যায়নি';
      }
    })
  );
  if (used) await DailyActivity.updateOne({ user: user._id, day: dhakaDay() }, { $inc: { aiGradings: used } }, { upsert: true });
}

/** Grades and closes an attempt. Returns { xp, previousBest }. */
export async function finalizeAttempt(attempt, user) {
  const ids = [...attempt.mcq, ...attempt.cq].map((a) => a.question);
  const qmap = new Map((await Question.find({ _id: { $in: ids } })).map((q) => [String(q._id), q]));

  for (const a of attempt.mcq) {
    const q = qmap.get(String(a.question));
    a.correct = Boolean(q) && a.picked !== null && a.picked === q.answer;
    a.locked = true;
  }
  await gradeCqs(attempt, user, qmap);

  attempt.status = 'submitted';
  attempt.submittedAt = new Date();
  attempt.durationSec = Math.round((attempt.submittedAt - attempt.startedAt) / 1000);
  computeScore(attempt);
  const { delta, previousBest } = await awardXp(attempt, user, { countQuiz: true });
  await attempt.save();

  await updateMistakes(attempt, user, qmap);
  if (attempt.kind === 'topic') {
    await Progress.updateOne({ user: user._id, topic: attempt.topic }, { $max: { bestQuizScore: attempt.score.percent } });
  }
  // The XP step ran before the attempt was saved, so test badges and the study plan are checked again now that it counts.
  if ((await checkBadges(user)).length) await user.save();
  await syncPlanFor(user);
  return { xp: delta, previousBest };
}

/** After a student self-marks a CQ: rescore and top up XP if the attempt improved. */
export async function rescoreAttempt(attempt, user) {
  computeScore(attempt);
  const { delta } = await awardXp(attempt, user);
  await attempt.save();
  if (attempt.kind === 'topic') {
    await Progress.updateOne({ user: user._id, topic: attempt.topic }, { $max: { bestQuizScore: attempt.score.percent } });
  }
  if ((await checkBadges(user)).length) await user.save();
  return delta;
}
