import { z } from 'zod';
import { Payment } from '../models/Payment.js';
import { PLANS, findPlan } from '../config/plans.js';
import { availableMethods } from '../services/subscription.js';
import { badRequest, conflict } from '../utils/AppError.js';

const MAX_PENDING = 3;

const bnToEn = (s) => String(s).replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d));

/** "+880 1712-345678" / "০১৭১২৩৪৫৬৭৮" → "01712345678" */
export const normalizePhone = (s) => bnToEn(s).replace(/\D/g, '').replace(/^88(?=01)/, '');

export const submitSchema = z.object({
  plan: z.string().refine((k) => findPlan(k), 'প্যাকেজ সঠিক নয়'),
  method: z.enum(['bkash', 'nagad']),
  senderNumber: z
    .string()
    .transform(normalizePhone)
    .refine((v) => /^01[3-9]\d{8}$/.test(v), 'যে নম্বর থেকে টাকা পাঠিয়েছ সেটি ১১ সংখ্যার মোবাইল নম্বর হতে হবে'),
  trxId: z
    .string()
    .transform((v) => bnToEn(v).replace(/\s/g, '').toUpperCase())
    .refine((v) => /^[A-Z0-9]{6,20}$/.test(v), 'ট্রানজেকশন আইডি ৬–২০ অক্ষরের ইংরেজি অক্ষর/সংখ্যা হয় (যেমন 9A7B6C5D4E)'),
});

/** GET /payments/info — plans and where to send money. */
export async function info(_req, res) {
  res.json({ plans: PLANS, ...(await availableMethods()) });
}

/** GET /payments/mine — this student's payment history, newest first. */
export async function mine(req, res) {
  const payments = await Payment.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ payments: payments.map((p) => p.toPublic()) });
}

/** POST /payments — student submits sender number + TrxID after sending money. */
export async function submit(req, res) {
  const { plan: planKey, method, senderNumber, trxId } = req.body;
  if (req.user.role === 'admin') throw badRequest('অ্যাডমিন অ্যাকাউন্টে পেমেন্ট লাগে না');

  const { methods } = await availableMethods();
  const target = methods.find((m) => m.key === method);
  if (!target) throw badRequest('এই মাধ্যমে এখন পেমেন্ট নেওয়া হচ্ছে না');

  const pending = await Payment.countDocuments({ user: req.user._id, status: 'pending' });
  if (pending >= MAX_PENDING) throw badRequest('তোমার কয়েকটি পেমেন্ট এখনো যাচাই হচ্ছে — সেগুলো শেষ হলে আবার জমা দাও');

  if (await Payment.exists({ trxId })) {
    throw conflict('এই ট্রানজেকশন আইডি আগেই জমা দেওয়া হয়েছে। ভুল মনে হলে আইডিটা আবার মিলিয়ে দেখো।', 'DUPLICATE_TRX');
  }

  const plan = findPlan(planKey);
  const payment = await Payment.create({
    user: req.user._id,
    plan: plan.key,
    months: plan.months,
    amount: plan.price,
    method,
    payTo: target.number,
    senderNumber,
    trxId,
  });
  res.status(201).json({ payment: payment.toPublic() });
}
