import mongoose from 'mongoose';
import { EXAM_KINDS } from '../config/exams.js';

const { ObjectId } = mongoose.Schema.Types;

const mcqAnswerSchema = new mongoose.Schema(
  {
    question: { type: ObjectId, ref: 'Question', required: true },
    picked: { type: Number, default: null }, // null = skipped
    correct: { type: Boolean, default: false },
    locked: { type: Boolean, default: false }, // instant mode: answer revealed, can't change
  },
  { _id: false }
);

const cqPartAnswerSchema = new mongoose.Schema(
  {
    text: { type: String, default: '' },
    score: { type: Number, default: null },
    max: { type: Number, required: true },
    feedback: { type: String },
    missing: { type: [String], default: undefined },
  },
  { _id: false }
);

const cqAnswerSchema = new mongoose.Schema(
  {
    question: { type: ObjectId, ref: 'Question', required: true },
    parts: { type: [cqPartAnswerSchema], default: [] },
    // ai = graded by the AI examiner; self = student marked it against the model answer; skipped = not attempted
    grading: { type: String, enum: ['none', 'ai', 'self', 'skipped'], default: 'none' },
    model: { type: String },
    error: { type: String },
    // Admin check of an AI grade (Phase 8). originalScores = the AI's part scores before any admin change.
    review: {
      type: new mongoose.Schema(
        {
          verdict: { type: String, enum: ['ok', 'bad'] },
          note: { type: String },
          originalScores: { type: [Number], default: undefined },
          by: { type: ObjectId, ref: 'User' },
          at: { type: Date },
        },
        { _id: false }
      ),
      default: undefined,
    },
  },
  { _id: false }
);

const attemptSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: EXAM_KINDS, required: true },
    scopeKey: { type: String, required: true }, // "topic:<id>" | "chapter:<id>" | "full"
    chapter: { type: ObjectId, ref: 'Chapter' },
    topic: { type: ObjectId, ref: 'Topic' },
    title: { type: String },
    instant: { type: Boolean, default: false },
    cqChoose: { type: Number, default: 0 },
    timeLimitSec: { type: Number, default: null },
    mcq: { type: [mcqAnswerSchema], default: [] },
    cq: { type: [cqAnswerSchema], default: [] },
    status: { type: String, enum: ['in_progress', 'submitted'], default: 'in_progress' },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date },
    durationSec: { type: Number },
    score: {
      mcq: { type: Number, default: 0 },
      mcqTotal: { type: Number, default: 0 },
      cq: { type: Number, default: 0 },
      cqTotal: { type: Number, default: 0 },
      cqPending: { type: Boolean, default: false }, // some CQ still needs self-marking
      percent: { type: Number, default: 0 },
    },
    xpAwarded: { type: Number, default: 0 },
  },
  { timestamps: true }
);

attemptSchema.index({ user: 1, scopeKey: 1, status: 1 });
attemptSchema.index({ user: 1, createdAt: -1 });
attemptSchema.index({ 'cq.grading': 1, submittedAt: -1 });

export const Attempt = mongoose.model('Attempt', attemptSchema);
