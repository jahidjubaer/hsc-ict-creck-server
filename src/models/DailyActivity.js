import mongoose from 'mongoose';

// One document per user per Bangladesh calendar day. Drives streaks and the activity heatmap.
const dailyActivitySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    day: { type: String, required: true }, // YYYY-MM-DD (Asia/Dhaka)
    xp: { type: Number, default: 0 },
    seconds: { type: Number, default: 0 },
    topicsCompleted: { type: Number, default: 0 },
    quizzes: { type: Number, default: 0 },
    aiGradings: { type: Number, default: 0 }, // CQ answers sent to the AI examiner (daily cap)
  },
  { timestamps: true }
);

dailyActivitySchema.index({ user: 1, day: 1 }, { unique: true });

export const DailyActivity = mongoose.model('DailyActivity', dailyActivitySchema);
