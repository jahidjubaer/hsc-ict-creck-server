import { z } from 'zod';
import mongoose from 'mongoose';
import { StudyPlan, MANUAL_KINDS } from '../models/StudyPlan.js';
import { buildDays, daysBetween, shiftDay, syncPlan } from '../services/studyPlan.js';
import { dhakaDay } from '../utils/dates.js';
import { env } from '../config/env.js';
import { badRequest, notFound } from '../utils/AppError.js';

const MIN_DAYS = 7;
const MAX_DAYS = 400;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'তারিখ সঠিক নয়');
const settingsShape = {
  examDate: day,
  dailyMinutes: z.coerce.number().int().min(15).max(300),
  restDay: z.number().int().min(0).max(6).nullable().default(null),
  order: z.enum(['priority', 'syllabus']).default('priority'),
};
export const createSchema = z.object(settingsShape);
export const updateSchema = z.object(settingsShape).partial();
export const taskSchema = z.object({ done: z.boolean() });
export const icsQuery = z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('20:00') });

function checkExamDate(examDate) {
  const left = daysBetween(dhakaDay(), examDate);
  if (Number.isNaN(left)) throw badRequest('পরীক্ষার তারিখ সঠিক নয়');
  if (left < MIN_DAYS) throw badRequest(`পরীক্ষার তারিখ অন্তত ${MIN_DAYS} দিন পরে হতে হবে`);
  if (left > MAX_DAYS) throw badRequest('পরীক্ষার তারিখ এক বছরের বেশি দূরে দেওয়া যাবে না');
}

/** Plan + numbers the page needs. */
function view(plan) {
  const today = dhakaDay();
  const all = plan.days.flatMap((d) => d.tasks);
  const overdue = plan.days.filter((d) => d.date < today).flatMap((d) => d.tasks.filter((t) => !t.done));
  const todayPlan = plan.days.find((d) => d.date === today) ?? null;
  return {
    plan: {
      _id: plan._id,
      examDate: plan.examDate,
      dailyMinutes: plan.dailyMinutes,
      plannedMinutes: plan.plannedMinutes,
      restDay: plan.restDay,
      order: plan.order,
      bonusDays: plan.bonusDays,
      createdAt: plan.createdAt,
      replannedAt: plan.replannedAt,
      days: plan.days,
    },
    today,
    todayPlan,
    stats: {
      totalTasks: all.length,
      doneTasks: all.filter((t) => t.done).length,
      overdueTasks: overdue.length,
      overdueMinutes: overdue.reduce((s, t) => s + t.minutes, 0),
      examInDays: daysBetween(today, plan.examDate),
      learnDaysLeft: plan.days.filter((d) => d.date >= today && d.phase === 'learn').length,
    },
    dayBonus: plan.$locals.dayBonus ?? false,
  };
}

async function loadPlan(user) {
  const plan = await StudyPlan.findOne({ user: user._id });
  if (!plan) throw notFound('এখনো কোনো স্টাডি প্ল্যান নেই', 'NO_PLAN');
  return plan;
}

/** GET /plan — the plan with tasks ticked from real activity, or { plan: null }. */
export async function get(req, res) {
  const plan = await StudyPlan.findOne({ user: req.user._id });
  if (!plan) return res.json({ plan: null, today: dhakaDay() });
  await syncPlan(req.user, plan);
  res.json(view(plan));
}

/** POST /plan — a brand-new plan from today (replaces any old one; the full-day count carries over). */
export async function create(req, res) {
  checkExamDate(req.body.examDate);
  const old = await StudyPlan.findOneAndDelete({ user: req.user._id });
  const { days, plannedMinutes } = await buildDays(req.user, req.body);
  const plan = await StudyPlan.create({ user: req.user._id, ...req.body, days, plannedMinutes, bonusDays: old?.bonusDays ?? 0 });
  await syncPlan(req.user, plan);
  res.status(201).json(view(plan));
}

/** PATCH /plan — re-plan from today (optionally with new settings); past days stay as they were. */
export async function replan(req, res) {
  const plan = await loadPlan(req.user);
  Object.assign(plan, req.body);
  checkExamDate(plan.examDate);
  const today = dhakaDay();
  const { days, plannedMinutes } = await buildDays(req.user, plan, today);
  plan.days = [...plan.days.filter((d) => d.date < today), ...days];
  plan.plannedMinutes = plannedMinutes;
  plan.replannedAt = new Date();
  await plan.save();
  await syncPlan(req.user, plan);
  res.json(view(plan));
}

/** PATCH /plan/tasks/:taskId — tick a revision / mistake-book task by hand. */
export async function setTask(req, res) {
  if (!mongoose.isValidObjectId(req.params.taskId)) throw notFound('কাজটি পাওয়া যায়নি');
  const plan = await loadPlan(req.user);
  const task = plan.days.flatMap((d) => d.tasks).find((t) => String(t._id) === req.params.taskId);
  if (!task) throw notFound('কাজটি পাওয়া যায়নি');
  if (!MANUAL_KINDS.includes(task.kind)) throw badRequest('এই কাজটি পড়া/পরীক্ষা শেষ করলে নিজে থেকেই টিক হয়');
  task.done = req.body.done;
  task.doneAt = req.body.done ? new Date() : undefined;
  await plan.save();
  await syncPlan(req.user, plan);
  res.json(view(plan));
}

export async function remove(req, res) {
  await StudyPlan.deleteOne({ user: req.user._id });
  res.json({ ok: true });
}

const icsText = (s) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

/** GET /plan/calendar.ics — one daily reminder (with an alarm) until the exam, for the phone's calendar app. */
export async function calendar(req, res) {
  const plan = await loadPlan(req.user);
  const [hh, mm] = req.validatedQuery.time.split(':');
  const start = dhakaDay().replace(/-/g, '');
  const until = shiftDay(plan.examDate, -1).replace(/-/g, '');
  const minutes = plan.plannedMinutes ?? plan.dailyMinutes;
  const url = `${env.CLIENT_URL.split(',')[0]}/plan`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const restRule = plan.restDay === null ? '' : `;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].filter((_, i) => i !== plan.restDay).join(',')}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ICT Crack//Study Plan//BN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Dhaka',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0600',
    'TZOFFSETTO:+0600',
    'TZNAME:BST',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:plan-${plan._id}@ict-crack`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Asia/Dhaka:${start}T${hh}${mm}00`,
    `DURATION:PT${minutes}M`,
    `RRULE:FREQ=DAILY;UNTIL=${until}T175959Z${restRule}`, // UNTIL must be UTC with a TZID start (23:59:59 Dhaka)
    `SUMMARY:${icsText(`ICT Crack: আজকের পড়া (${String(minutes).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d])} মিনিট)`)}`,
    `DESCRIPTION:${icsText(`আজকের স্টাডি প্ল্যান দেখো: ${url}`)}`,
    `URL:${url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:PT0M',
    `DESCRIPTION:${icsText('পড়ার সময় হয়েছে — স্ট্রিক ধরে রাখো!')}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="ict-crack-study-plan.ics"');
  res.send(lines.join('\r\n'));
}
