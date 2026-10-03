import { Chapter } from '../models/Chapter.js';
import { Topic } from '../models/Topic.js';
import { Progress } from '../models/Progress.js';
import { Attempt } from '../models/Attempt.js';
import { StudyPlan } from '../models/StudyPlan.js';
import { EXAMS } from '../config/exams.js';
import { CHAPTER_A_PLUS } from '../config/gamification.js';
import { recordActivity } from './activity.js';
import { dhakaDay } from '../utils/dates.js';

export const PLAN_DAY_XP = 10;
const QUIZ_MIN = 10;
const MISTAKES_MIN = 15;
const MIN_DAY_LOAD = 30;
const MODEL_TEST_MIN = EXAMS.full.timeLimitMin;
const CHAPTER_TEST_MIN = EXAMS.chapter.timeLimitMin;
const BN = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);

/** 'YYYY-MM-DD' + n days (calendar maths in UTC so DST/timezones never shift the date). */
export function shiftDay(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const weekday = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** Study dates from `from` up to the day before the exam, skipping the weekly rest day. */
export function studyDates(from, examDate, restDay) {
  const out = [];
  for (let d = from; d < examDate; d = shiftDay(d, 1)) if (weekday(d) !== restDay) out.push(d);
  return out;
}

/** Days kept for revision at the end: ~15% of the study days (2–21), 1 for very short plans. */
export const revisionDayCount = (n) => (n >= 10 ? Math.min(21, Math.max(2, Math.round(n * 0.15))) : n >= 7 ? 1 : 0);

/** Everything still to learn, in study order: per chapter → read + quiz for each topic, then the chapter test. */
async function learningQueue(user, order) {
  const [chapters, topics, done, quizzed, chapterBest] = await Promise.all([
    Chapter.find({ published: true }).select('number slug title priority').lean(),
    Topic.find({ published: true }).select('chapter slug title order estMinutes').sort({ order: 1 }).lean(),
    Progress.distinct('topic', { user: user._id, status: 'completed' }),
    Attempt.distinct('topic', { user: user._id, kind: 'topic', status: 'submitted' }),
    Attempt.aggregate([
      { $match: { user: user._id, kind: 'chapter', status: 'submitted' } },
      { $group: { _id: '$chapter', best: { $max: '$score.percent' } } },
    ]),
  ]);
  const doneSet = new Set(done.map(String));
  const quizSet = new Set(quizzed.map(String));
  const bestBy = new Map(chapterBest.map((c) => [String(c._id), c.best]));
  const sorted = [...chapters].sort((a, b) => (order === 'priority' ? Number(b.priority) - Number(a.priority) : 0) || a.number - b.number);

  const queue = [];
  for (const ch of sorted) {
    const base = { chapter: ch._id, chapterNumber: ch.number, chapterSlug: ch.slug };
    for (const t of topics.filter((x) => String(x.chapter) === String(ch._id))) {
      const ref = { ...base, topic: t._id, topicSlug: t.slug };
      if (!doneSet.has(String(t._id))) queue.push({ ...ref, kind: 'read', title: t.title, minutes: t.estMinutes || 15 });
      if (!quizSet.has(String(t._id))) queue.push({ ...ref, kind: 'quiz', title: `কুইজ: ${t.title}`, minutes: QUIZ_MIN });
    }
    if ((bestBy.get(String(ch._id)) ?? -1) < CHAPTER_A_PLUS) {
      queue.push({ ...base, kind: 'chapter-test', title: `অধ্যায় ${BN(ch.number)} পরীক্ষা: ${ch.title}`, minutes: CHAPTER_TEST_MIN });
    }
  }
  return { queue, chapters: sorted };
}

/**
 * Builds the day-by-day schedule from `from` to the exam.
 * Learning days are packed greedily up to an even daily load (a day always gets at least one task, so a long chapter
 * test can make one day heavier). The load is reported as plannedMinutes: below dailyMinutes when there is slack,
 * above it when the work doesn't fit.
 * The last days — and any days left after learning ends — are revision: chapter revision in turn, model tests every
 * third revision day, and a light final day.
 */
export async function buildDays(user, { examDate, dailyMinutes, restDay, order }, from = dhakaDay()) {
  const dates = studyDates(from, examDate, restDay);
  if (!dates.length) return { days: [], plannedMinutes: dailyMinutes, learnMinutes: 0 };
  const { queue, chapters } = await learningQueue(user, order);

  const reviseCount = revisionDayCount(dates.length);
  const learnDates = dates.slice(0, dates.length - reviseCount);
  const weeklyMistakes = Math.floor(learnDates.length / 7);
  const learnMinutes = queue.reduce((s, t) => s + t.minutes, 0) + weeklyMistakes * MISTAKES_MIN;
  // Spread learning evenly over the learning days, but never thinner than min(daily, 30) minutes a day; raised above
  // the student's daily minutes only when the work doesn't fit.
  const even = learnDates.length ? Math.ceil(learnMinutes / learnDates.length) : dailyMinutes;
  const cap = Math.max(even, Math.min(dailyMinutes, MIN_DAY_LOAD));

  const days = [];
  let i = 0;
  for (const [n, date] of learnDates.entries()) {
    if (i >= queue.length) break;
    const tasks = [];
    let used = 0;
    if ((n + 1) % 7 === 0) {
      tasks.push({ kind: 'mistakes', title: 'সাপ্তাহিক রিভিউ: ভুলের খাতা', minutes: MISTAKES_MIN });
      used += MISTAKES_MIN;
    }
    while (i < queue.length && (used === 0 || used + queue[i].minutes <= cap)) {
      tasks.push(queue[i]);
      used += queue[i].minutes;
      i += 1;
    }
    days.push({ date, phase: 'learn', tasks });
  }
  // Didn't fit even at the raised load (big items) → the rest goes on the last learning day.
  if (i < queue.length && days.length) days.at(-1).tasks.push(...queue.slice(i));

  const revisionDates = dates.slice(days.length);
  const revOrder = chapters.length ? chapters : [];
  revisionDates.forEach((date, k) => {
    const last = k === revisionDates.length - 1;
    const tasks = [];
    if (last && revisionDates.length > 1) {
      tasks.push({ kind: 'revise', title: 'শেষ দিনের প্রস্তুতি: সব অধ্যায়ের মূল কথা ও সূত্র এক নজরে', minutes: Math.min(dailyMinutes, 45) });
    } else {
      const ch = revOrder[k % Math.max(1, revOrder.length)];
      if (ch) {
        tasks.push({
          kind: 'revise',
          title: `রিভিশন: অধ্যায় ${BN(ch.number)} — মূল কথা, ফ্ল্যাশকার্ড ও নোট`,
          minutes: Math.max(15, Math.min(dailyMinutes, 40)),
          chapter: ch._id,
          chapterNumber: ch.number,
          chapterSlug: ch.slug,
        });
      }
      if (k % 3 === 2 || (revisionDates.length < 3 && k === 0)) {
        tasks.push({ kind: 'model-test', title: 'পূর্ণাঙ্গ MCQ মডেল টেস্ট (২৫ মিনিট)', minutes: MODEL_TEST_MIN });
      } else if (k % 3 === 1) {
        tasks.push({ kind: 'mistakes', title: 'ভুলের খাতা থেকে অনুশীলন', minutes: MISTAKES_MIN });
      }
    }
    days.push({ date, phase: 'revise', tasks });
  });

  return { days, plannedMinutes: cap, learnMinutes };
}

/**
 * Ticks auto tasks from real activity (topic completed, quiz / chapter test / model test submitted) and gives the
 * whole-day bonus once when today's list is finished. Saves the plan when anything changed.
 */
export async function syncPlan(user, plan) {
  if (!plan) return plan;
  const [done, quizzed, tested, fullCount] = await Promise.all([
    Progress.distinct('topic', { user: user._id, status: 'completed' }),
    Attempt.distinct('topic', { user: user._id, kind: 'topic', status: 'submitted' }),
    Attempt.distinct('chapter', { user: user._id, kind: 'chapter', status: 'submitted' }),
    Attempt.countDocuments({ user: user._id, kind: 'full', status: 'submitted', submittedAt: { $gte: plan.createdAt } }),
  ]);
  const sets = { read: new Set(done.map(String)), quiz: new Set(quizzed.map(String)), 'chapter-test': new Set(tested.map(String)) };
  const now = new Date();
  let changed = false;
  let modelLeft = fullCount; // each model test taken since the plan began ticks the next model-test task

  for (const day of plan.days) {
    for (const t of day.tasks) {
      let isDone = t.done;
      if (t.kind === 'read' || t.kind === 'quiz') isDone = sets[t.kind].has(String(t.topic));
      else if (t.kind === 'chapter-test') isDone = sets['chapter-test'].has(String(t.chapter));
      else if (t.kind === 'model-test') isDone = modelLeft-- > 0;
      if (isDone !== t.done) {
        t.done = isDone;
        t.doneAt = isDone ? now : undefined;
        changed = true;
      }
    }
  }

  const today = dhakaDay();
  const todayPlan = plan.days.find((d) => d.date === today);
  let bonus = false;
  if (todayPlan && !todayPlan.bonus && todayPlan.tasks.length && todayPlan.tasks.every((t) => t.done)) {
    todayPlan.bonus = true;
    plan.bonusDays += 1;
    changed = true;
    bonus = true;
  }
  if (changed) await plan.save();
  if (bonus) await recordActivity(user, { xp: PLAN_DAY_XP }); // also re-checks badges (plan-day badges)
  plan.$locals.dayBonus = bonus;
  return plan;
}

/** Re-sync after activity that can tick a task (topic completed, test submitted). Never throws. */
export async function syncPlanFor(user) {
  try {
    const plan = await StudyPlan.findOne({ user: user._id });
    if (plan) await syncPlan(user, plan);
  } catch (err) {
    console.error('study plan sync failed:', err.message);
  }
}
