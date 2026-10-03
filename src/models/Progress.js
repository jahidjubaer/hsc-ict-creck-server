import mongoose from 'mongoose';

const progressSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    topic: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic', required: true },
    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', required: true },
    status: { type: String, enum: ['reading', 'completed'], default: 'reading' },
    readPercent: { type: Number, default: 0, min: 0, max: 100 },
    timeSpentSec: { type: Number, default: 0 },
    completedAt: { type: Date },
    bestQuizScore: { type: Number }, // percent, filled by Phase 3
    bookmarked: { type: Boolean, default: false },
    note: { type: String, maxlength: 5000 },
    // Text the student highlighted: block index + character offsets inside that block's text (text kept to re-find it).
    highlights: [
      {
        _id: false,
        block: { type: Number, required: true },
        start: { type: Number, required: true },
        end: { type: Number, required: true },
        text: { type: String, maxlength: 1000 },
        color: { type: String, enum: ['yellow', 'green', 'blue', 'pink'], default: 'yellow' },
      },
    ],
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

progressSchema.index({ user: 1, topic: 1 }, { unique: true });
progressSchema.index({ user: 1, chapter: 1 });
progressSchema.index({ user: 1, lastSeenAt: -1 });

export const Progress = mongoose.model('Progress', progressSchema);
