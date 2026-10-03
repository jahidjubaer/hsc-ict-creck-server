import mongoose from 'mongoose';

// Mistake book: every wrongly answered MCQ, until the student gets it right twice in a row.
const mistakeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
    chapterNumber: { type: Number },
    wrongCount: { type: Number, default: 1 },
    rightStreak: { type: Number, default: 0 },
    lastPicked: { type: Number },
    lastWrongAt: { type: Date, default: Date.now },
    resolved: { type: Boolean, default: false },
  },
  { timestamps: true }
);

mistakeSchema.index({ user: 1, question: 1 }, { unique: true });
mistakeSchema.index({ user: 1, resolved: 1, lastWrongAt: -1 });

export const Mistake = mongoose.model('Mistake', mistakeSchema);
