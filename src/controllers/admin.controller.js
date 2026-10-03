import { z } from 'zod';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Payment } from '../models/Payment.js';
import { Attempt } from '../models/Attempt.js';
import { AdminLog, logAdmin } from '../models/AdminLog.js';
import { activateSubscription, getPaymentSettings, savePaymentSettings } from '../services/subscription.js';
import { addDays } from '../utils/dates.js';
import { escapeRegex } from '../utils/regex.js';
import { badRequest, notFound } from '../utils/AppError.js';

export const PAGE = 25;
export const pageParam = z.coerce.number().int().min(1).default(1);

// ---------------------------------------------------------------- dashboard

const premiumQuery = (now) => ({ 'subscription.status': 'active', 'subscription.expiresAt': { $gt: now } });

/** GET /admin/stats */
export async function stats(_req, res) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const premiumQ = premiumQuery(now);
  const [pending, users, newWeek, premium, trial, revenue, aiWeek] = await Promise.all([
    Payment.countDocuments({ status: 'pending' }),
    User.countDocuments({ role: 'student' }),
    User.countDocuments({ role: 'student', createdAt: { $gt: addDays(now, -7) } }),
    User.countDocuments({ role: 'student', ...premiumQ }),
    User.countDocuments({ role: 'student', trialEndsAt: { $gt: now }, $nor: [premiumQ] }),
    Payment.aggregate([
      { $match: { status: 'approved', reviewedAt: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: '$amount' }, n: { $sum: 1 } } },
    ]),
    Attempt.aggregate([
      { $match: { status: 'submitted', submittedAt: { $gt: addDays(now, -7) }, 'cq.grading': 'ai' } },
      { $unwind: '$cq' },
      { $match: { 'cq.grading': 'ai' } },
      { $group: { _id: { $ifNull: ['$cq.review.verdict', 'none'] }, n: { $sum: 1 } } },
    ]),
  ]);
  const ai = Object.fromEntries(aiWeek.map((r) => [r._id, r.n]));
  res.json({
    pendingPayments: pending,
    users,
    newUsersWeek: newWeek,
    premium,
    trial,
    expired: users - premium - trial,
    revenueMonth: revenue[0]?.total ?? 0,
    paymentsMonth: revenue[0]?.n ?? 0,
    ai: { week: (ai.none ?? 0) + (ai.ok ?? 0) + (ai.bad ?? 0), unreviewed: ai.none ?? 0, ok: ai.ok ?? 0, bad: ai.bad ?? 0 },
  });
}

// ---------------------------------------------------------------- payments

export const paymentListQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
  q: z.string().trim().max(80).optional(),
  page: pageParam,
});

/** GET /admin/payments — oldest first for the pending queue, newest first otherwise. */
export async function listPayments(req, res) {
  const { status, q, page } = req.validatedQuery;
  const filter = status === 'all' ? {} : { status };
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const users = await User.find({ $or: [{ email: rx }, { name: rx }, { phone: rx }] }).select('_id').limit(200).lean();
    filter.$or = [{ trxId: rx }, { senderNumber: rx }, { user: { $in: users.map((u) => u._id) } }];
  }
  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .sort({ createdAt: status === 'pending' ? 1 : -1 })
      .skip((page - 1) * PAGE)
      .limit(PAGE)
      .populate('user', 'name email phone')
      .populate('reviewedBy', 'name')
      .lean(),
    Payment.countDocuments(filter),
  ]);

  // Hints for the reviewer: the same sender number used by other accounts, and this student's earlier rejections.
  const senders = [...new Set(payments.map((p) => p.senderNumber))];
  const userIds = [...new Set(payments.map((p) => String(p.user?._id)))].map((id) => new mongoose.Types.ObjectId(id));
  const [bySender, rejected] = await Promise.all([
    Payment.aggregate([{ $match: { senderNumber: { $in: senders } } }, { $group: { _id: '$senderNumber', users: { $addToSet: '$user' } } }]),
    Payment.aggregate([{ $match: { user: { $in: userIds }, status: 'rejected' } }, { $group: { _id: '$user', n: { $sum: 1 } } }]),
  ]);
  const senderUsers = new Map(bySender.map((r) => [r._id, r.users.length]));
  const rejectedBy = new Map(rejected.map((r) => [String(r._id), r.n]));
  res.json({
    payments: payments.map((p) => ({
      ...p,
      hints: { senderAccounts: senderUsers.get(p.senderNumber) ?? 1, rejectedBefore: rejectedBy.get(String(p.user?._id)) ?? 0 },
    })),
    total,
    pageSize: PAGE,
  });
}

/** POST /admin/payments/:id/approve — turns the subscription on (or extends it). Also undoes a mistaken rejection. */
export async function approvePayment(req, res) {
  const payment = await Payment.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ['pending', 'rejected'] } },
    { $set: { status: 'approved', reviewedBy: req.user._id, reviewedAt: new Date() }, $unset: { rejectReason: 1 } },
    { returnDocument: 'after' }
  );
  if (!payment) throw badRequest('পেমেন্টটি পাওয়া যায়নি বা আগেই অনুমোদিত');
  const user = await User.findById(payment.user);
  if (!user) throw notFound('শিক্ষার্থী পাওয়া যায়নি');

  const { start, end } = await activateSubscription(user, { plan: payment.plan, months: payment.months });
  payment.periodStart = start;
  payment.periodEnd = end;
  await payment.save();
  await logAdmin(req, 'payment.approve', {
    user: user._id,
    ref: payment._id,
    details: { trxId: payment.trxId, amount: payment.amount, until: end },
  });
  res.json({ payment });
}

export const rejectSchema = z.object({ reason: z.string().trim().min(3, 'কারণ লেখো').max(300) });

/** POST /admin/payments/:id/reject */
export async function rejectPayment(req, res) {
  const payment = await Payment.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },
    { $set: { status: 'rejected', rejectReason: req.body.reason, reviewedBy: req.user._id, reviewedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!payment) throw badRequest('শুধু অপেক্ষমাণ পেমেন্ট বাতিল করা যায়');
  await logAdmin(req, 'payment.reject', { user: payment.user, ref: payment._id, details: { trxId: payment.trxId, reason: req.body.reason } });
  res.json({ payment });
}

// ---------------------------------------------------------------- users

export const userListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  filter: z.enum(['all', 'trial', 'premium', 'expired', 'admin']).default('all'),
  page: pageParam,
});

function accessFilter(filter, now = new Date()) {
  const premium = premiumQuery(now);
  switch (filter) {
    case 'admin':
      return { role: 'admin' };
    case 'premium':
      return { role: 'student', ...premium };
    case 'trial':
      return { role: 'student', trialEndsAt: { $gt: now }, $nor: [premium] };
    case 'expired':
      return { role: 'student', trialEndsAt: { $lte: now }, $nor: [premium] };
    default:
      return {};
  }
}

const userRow = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  xp: u.xp,
  trialEndsAt: u.trialEndsAt,
  subscription: u.subscription,
  access: u.accessInfo(),
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

/** GET /admin/users */
export async function listUsers(req, res) {
  const { q, filter, page } = req.validatedQuery;
  const where = accessFilter(filter);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    where.$and = [{ $or: [{ email: rx }, { name: rx }, { phone: rx }] }];
  }
  const [users, total] = await Promise.all([
    User.find(where).sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE),
    User.countDocuments(where),
  ]);
  res.json({ users: users.map(userRow), total, pageSize: PAGE });
}

async function loadUser(id) {
  if (!mongoose.isValidObjectId(id)) throw notFound('শিক্ষার্থী পাওয়া যায়নি');
  const user = await User.findById(id);
  if (!user) throw notFound('শিক্ষার্থী পাওয়া যায়নি');
  return user;
}

/** GET /admin/users/:id — profile, payments, test summary, admin log. */
export async function getUser(req, res) {
  const user = await loadUser(req.params.id);
  const [payments, attempts, logs] = await Promise.all([
    Payment.find({ user: user._id }).sort({ createdAt: -1 }).populate('reviewedBy', 'name').lean(),
    Attempt.aggregate([
      { $match: { user: user._id, status: 'submitted' } },
      { $group: { _id: '$kind', n: { $sum: 1 }, avg: { $avg: '$score.percent' } } },
    ]),
    AdminLog.find({ user: user._id }).sort({ createdAt: -1 }).limit(30).populate('admin', 'name').lean(),
  ]);
  res.json({
    user: { ...userRow(user), college: user.college, district: user.district, hscYear: user.hscYear, streak: user.streak },
    payments,
    attempts,
    logs,
  });
}

export const extendSchema = z.object({
  kind: z.enum(['trial', 'premium']),
  days: z.coerce.number().int().min(1).max(800),
  note: z.string().trim().max(200).optional(),
});

/** POST /admin/users/:id/extend — add days to the trial or to premium (gift / compensation). */
export async function extendUser(req, res) {
  const user = await loadUser(req.params.id);
  const { kind, days, note } = req.body;
  const now = new Date();
  if (kind === 'trial') {
    user.trialEndsAt = addDays(user.trialEndsAt > now ? user.trialEndsAt : now, days);
  } else {
    const sub = user.subscription;
    const active = sub?.status === 'active' && sub.expiresAt > now;
    user.subscription = { plan: active ? sub.plan : 'manual', status: 'active', expiresAt: addDays(active ? sub.expiresAt : now, days) };
  }
  await user.save();
  await logAdmin(req, 'user.extend', { user: user._id, details: { kind, days, note } });
  res.json({ user: userRow(user) });
}

export const cancelSchema = z.object({
  kind: z.enum(['trial', 'premium']),
  note: z.string().trim().max(200).optional(),
});

/** POST /admin/users/:id/cancel — end premium (or the trial) now. */
export async function cancelUser(req, res) {
  const user = await loadUser(req.params.id);
  const now = new Date();
  if (req.body.kind === 'trial') {
    if (user.trialEndsAt > now) user.trialEndsAt = now;
  } else {
    if (user.subscription?.status !== 'active') throw badRequest('কোনো সক্রিয় প্যাকেজ নেই');
    user.subscription = { plan: user.subscription.plan, status: 'cancelled', expiresAt: now };
    // Close the periods those payments bought, so the student's history doesn't keep showing them as active.
    await Payment.updateMany({ user: user._id, status: 'approved', periodEnd: { $gt: now } }, [
      { $set: { periodEnd: now, periodStart: { $min: ['$periodStart', now] } } },
    ], { updatePipeline: true });
  }
  await user.save();
  await logAdmin(req, 'user.cancel', { user: user._id, details: req.body });
  res.json({ user: userRow(user) });
}

// ---------------------------------------------------------------- settings

const methodSettings = z.object({
  number: z
    .string()
    .trim()
    .refine((v) => v === '' || /^01[3-9]\d{8}$/.test(v), '১১ সংখ্যার মোবাইল নম্বর দাও (01XXXXXXXXX)'),
  type: z.enum(['personal', 'merchant']),
  enabled: z.boolean(),
});
export const paymentSettingsSchema = z.object({
  bkash: methodSettings,
  nagad: methodSettings,
  note: z.string().trim().max(300).default(''),
});

export async function getSettings(_req, res) {
  res.json({ payment: await getPaymentSettings() });
}

export async function updatePaymentSettings(req, res) {
  for (const m of ['bkash', 'nagad']) {
    if (req.body[m].enabled && !req.body[m].number) throw badRequest('চালু করতে হলে নম্বর দিতে হবে');
  }
  const payment = await savePaymentSettings(req.body, req.user._id);
  await logAdmin(req, 'settings.payment', { details: req.body });
  res.json({ payment });
}
