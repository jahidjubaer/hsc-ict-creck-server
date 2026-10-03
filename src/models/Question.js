import mongoose from 'mongoose';

const cqPartSchema = new mongoose.Schema(
  {
    q: { type: String, required: true },
    marks: { type: Number, required: true },
    answer: { type: String, required: true }, // model answer (markdown)
    rubric: { type: [String], default: [] }, // points an examiner looks for
  },
  { _id: false }
);

// Question bank. Seeded from content/questions/ch<N>/<topic-slug>.js (key = "ch3/<slug>/<id>").
const questionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    type: { type: String, enum: ['mcq', 'cq'], required: true },
    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', required: true },
    chapterNumber: { type: Number, required: true },
    topic: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic' }, // null = chapter-level
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    source: {
      kind: { type: String, enum: ['practice', 'book', 'board'], default: 'practice' },
      board: String,
      year: Number,
    },
    // Shared situation text (উদ্দীপক) — MCQ situation sets and every CQ
    stimulus: { type: String },
    figure: { type: String }, // optional inline SVG
    // MCQ
    q: { type: String },
    options: { type: [String], default: undefined },
    answer: { type: Number },
    explain: { type: String },
    why: { type: [String], default: undefined }, // optional per-option explanations
    // CQ
    parts: { type: [cqPartSchema], default: undefined },
    active: { type: Boolean, default: true },
    // Set when an admin edits the question in the browser; the seed script then leaves it alone (see seed.js).
    adminEdit: {
      at: { type: Date },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
  },
  { timestamps: true }
);

questionSchema.index({ type: 1, chapter: 1, topic: 1, active: 1 });

/** Fields safe to send while an attempt is running (no answers). */
questionSchema.methods.toPublic = function toPublic() {
  const base = { _id: this._id, type: this.type, topic: this.topic, difficulty: this.difficulty, stimulus: this.stimulus, figure: this.figure };
  if (this.type === 'mcq') return { ...base, q: this.q, options: this.options };
  return { ...base, parts: this.parts.map((p) => ({ q: p.q, marks: p.marks })) };
};

export const Question = mongoose.model('Question', questionSchema);
