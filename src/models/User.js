import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { PLAN_KEYS } from '../config/plans.js';
import { levelInfo } from '../config/gamification.js';
import { dayDiff, dhakaDay } from '../utils/dates.js';

const streakSchema = new mongoose.Schema(
  {
    current: { type: Number, default: 0 },
    longest: { type: Number, default: 0 },
    lastActiveDay: { type: String, default: null }, // YYYY-MM-DD (Asia/Dhaka)
    freezes: { type: Number, default: 0 },
  },
  { _id: false }
);

const subscriptionSchema = new mongoose.Schema(
  {
    plan: { type: String, enum: ['none', 'manual', ...PLAN_KEYS], default: 'none' }, // manual = given by an admin
    status: { type: String, enum: ['none', 'active', 'expired', 'cancelled'], default: 'none' },
    expiresAt: { type: Date, default: null },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, select: false }, // absent for accounts made with Google
    passwordSet: { type: Boolean, default: true },
    googleUid: { type: String, unique: true, sparse: true },
    role: { type: String, enum: ['student', 'admin'], default: 'student' },
    phone: { type: String, trim: true },
    college: { type: String, trim: true, maxlength: 120 },
    district: { type: String, trim: true, maxlength: 40 },
    hscYear: { type: Number },
    avatar: { type: String },

    xp: { type: Number, default: 0, index: true },
    weeklyXp: { type: Number, default: 0 },
    weekKey: { type: String, default: null }, // ISO week the weeklyXp belongs to
    streak: { type: streakSchema, default: () => ({}) },
    badges: { type: [{ _id: false, key: { type: String, required: true }, at: { type: Date, default: Date.now } }], default: [] },

    trialEndsAt: { type: Date, required: true },
    subscription: { type: subscriptionSchema, default: () => ({}) },

    settings: {
      lang: { type: String, enum: ['bn', 'en'], default: 'bn' },
      dailyGoalMinutes: { type: Number, default: 30 },
      showOnLeaderboard: { type: Boolean, default: true },
    },

    tokenVersion: { type: Number, default: 0 }, // bump to invalidate all refresh tokens
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
  this.passwordSet = true;
};

userSchema.methods.checkPassword = function checkPassword(plain) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(plain, this.passwordHash);
};

/** Access state used by both the API (requireAccess) and the client (paywall UI). */
userSchema.methods.accessInfo = function accessInfo(now = new Date()) {
  if (this.role === 'admin') return { hasAccess: true, kind: 'admin', endsAt: null };
  const sub = this.subscription;
  if (sub?.status === 'active' && sub.expiresAt && sub.expiresAt > now) {
    return { hasAccess: true, kind: 'premium', endsAt: sub.expiresAt };
  }
  if (this.trialEndsAt > now) return { hasAccess: true, kind: 'trial', endsAt: this.trialEndsAt };
  return { hasAccess: false, kind: 'expired', endsAt: null };
};

/**
 * Streak as the student should see it right now: a missed day (not covered by freezes) shows 0 even before
 * the next activity resets the stored value. atRisk = still alive, but nothing done today yet.
 */
userSchema.methods.streakInfo = function streakInfo(today = dhakaDay()) {
  const s = this.streak ?? {};
  const base = { current: s.current ?? 0, longest: s.longest ?? 0, freezes: s.freezes ?? 0, lastActiveDay: s.lastActiveDay ?? null };
  if (!s.lastActiveDay) return { ...base, current: 0, todayDone: false, atRisk: false };
  const gap = dayDiff(s.lastActiveDay, today);
  if (gap <= 0) return { ...base, todayDone: true, atRisk: false };
  if (gap === 1 || base.freezes >= gap - 1) return { ...base, todayDone: false, atRisk: true, freezesNeeded: gap - 1 };
  return { ...base, current: 0, todayDone: false, atRisk: false };
};

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    name: this.name,
    email: this.email,
    role: this.role,
    phone: this.phone,
    college: this.college,
    district: this.district,
    hscYear: this.hscYear,
    avatar: this.avatar,
    hasPassword: this.passwordSet !== false,
    google: !!this.googleUid,
    xp: this.xp,
    level: levelInfo(this.xp).level,
    levelInfo: levelInfo(this.xp),
    streak: this.streakInfo(),
    badgeCount: this.badges?.length ?? 0,
    trialEndsAt: this.trialEndsAt,
    subscription: this.subscription,
    access: this.accessInfo(),
    settings: this.settings,
    createdAt: this.createdAt,
  };
};

userSchema.index({ weekKey: 1, weeklyXp: -1 });

export const User = mongoose.model('User', userSchema);
