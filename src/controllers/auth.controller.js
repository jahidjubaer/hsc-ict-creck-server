import { z } from 'zod';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { addDays } from '../utils/dates.js';
import { badRequest, conflict, unauthorized } from '../utils/AppError.js';
import {
  REFRESH_COOKIE,
  refreshCookieOptions,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../utils/tokens.js';

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'নাম কমপক্ষে ২ অক্ষরের হতে হবে').max(80),
  email: z.email('সঠিক ইমেইল দাও').trim().toLowerCase(),
  password: z.string().min(8, 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে').max(100),
  college: z.string().trim().max(120).optional(),
  district: z.string().trim().max(40).optional(),
  hscYear: z.coerce.number().int().min(2024).max(2035).optional(),
});

export const loginSchema = z.object({
  email: z.email('সঠিক ইমেইল দাও').trim().toLowerCase(),
  password: z.string().min(1, 'পাসওয়ার্ড দাও'),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().max(20).optional(),
  college: z.string().trim().max(120).optional(),
  district: z.string().trim().max(40).optional(),
  hscYear: z.coerce.number().int().min(2024).max(2035).optional(),
  settings: z
    .object({
      dailyGoalMinutes: z.coerce.number().int().min(10).max(300).optional(),
      showOnLeaderboard: z.boolean().optional(),
    })
    .optional(),
});

function sendSession(res, user, status = 200) {
  res.cookie(REFRESH_COOKIE, signRefreshToken(user), refreshCookieOptions());
  res.status(status).json({ accessToken: signAccessToken(user), user: user.toPublic() });
}

export async function register(req, res) {
  const { password, ...data } = req.body;
  if (await User.exists({ email: data.email })) throw conflict('এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে', 'EMAIL_TAKEN');

  const user = new User({ ...data, trialEndsAt: addDays(new Date(), env.TRIAL_DAYS), lastLoginAt: new Date() });
  await user.setPassword(password);
  await user.save();
  sendSession(res, user, 201);
}

export async function login(req, res) {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || !(await user.checkPassword(password))) {
    throw unauthorized('ইমেইল অথবা পাসওয়ার্ড ভুল', 'INVALID_CREDENTIALS');
  }
  user.lastLoginAt = new Date();
  await user.save();
  sendSession(res, user);
}

export async function refresh(req, res) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw unauthorized('সেশন পাওয়া যায়নি', 'NO_SESSION');

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw unauthorized('সেশনের মেয়াদ শেষ', 'NO_SESSION');
  }
  const user = await User.findById(payload.sub);
  if (!user || user.tokenVersion !== payload.v) throw unauthorized('সেশন বাতিল হয়েছে', 'NO_SESSION');
  sendSession(res, user); // rotates refresh cookie
}

export async function logout(_req, res) {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
  res.json({ ok: true });
}

export async function logoutAll(req, res) {
  req.user.tokenVersion += 1;
  await req.user.save();
  return logout(req, res);
}

export async function me(req, res) {
  res.json({ user: req.user.toPublic() });
}

export async function updateMe(req, res) {
  const { settings, ...rest } = req.body;
  Object.assign(req.user, rest);
  if (settings) Object.assign(req.user.settings, settings);
  await req.user.save();
  res.json({ user: req.user.toPublic() });
}

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে').max(100),
});

export async function changePassword(req, res) {
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!(await user.checkPassword(req.body.currentPassword))) throw badRequest('বর্তমান পাসওয়ার্ড ভুল', 'WRONG_PASSWORD');
  await user.setPassword(req.body.newPassword);
  user.tokenVersion += 1;
  await user.save();
  sendSession(res, user);
}
