import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

export const TASK_KINDS = ['read', 'quiz', 'chapter-test', 'chapter-cq', 'model-test', 'revise', 'mistakes'];
/** Tasks the student ticks by hand; the rest are ticked from real activity (services/studyPlan.js syncPlan). */
export const MANUAL_KINDS = ['revise', 'mistakes'];

const taskSchema = new mongoose.Schema({
  kind: { type: String, enum: TASK_KINDS, required: true },
  title: { type: String, required: true },
  minutes: { type: Number, required: true },
  chapter: { type: ObjectId, ref: 'Chapter' },
  chapterNumber: { type: Number },
  chapterSlug: { type: String },
  topic: { type: ObjectId, ref: 'Topic' },
  topicSlug: { type: String },
  done: { type: Boolean, default: false },
  doneAt: { type: Date },
});

const daySchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // YYYY-MM-DD (Asia/Dhaka)
    phase: { type: String, enum: ['learn', 'revise'], default: 'learn' },
    tasks: { type: [taskSchema], default: [] },
    bonus: { type: Boolean, default: false }, // whole day finished on the day → XP bonus given
  },
  { _id: false }
);

// One active plan per student. Re-planning keeps past days and rebuilds the rest.
const studyPlanSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true, unique: true },
    examDate: { type: String, required: true }, // YYYY-MM-DD
    dailyMinutes: { type: Number, required: true },
    restDay: { type: Number, min: 0, max: 6, default: null }, // 0 = Sunday … 5 = Friday, 6 = Saturday
    order: { type: String, enum: ['priority', 'syllabus'], default: 'priority' },
    // Minutes per study day actually needed when the work doesn't fit in dailyMinutes (else = dailyMinutes)
    plannedMinutes: { type: Number },
    days: { type: [daySchema], default: [] },
    bonusDays: { type: Number, default: 0 }, // days finished in full (kept across new plans, feeds a badge)
    replannedAt: { type: Date },
  },
  { timestamps: true }
);

export const StudyPlan = mongoose.model('StudyPlan', studyPlanSchema);
