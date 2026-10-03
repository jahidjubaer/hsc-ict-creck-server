import { env } from '../config/env.js';
import { Setting } from '../models/Setting.js';

/** Adds whole calendar months (31 Jan + 1 month → 28/29 Feb, never spills into March). */
export function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

/**
 * Where a newly bought period starts: after the current paid period, else after the remaining trial,
 * so paying early never throws away days the student already has.
 */
export function periodBase(user, now = new Date()) {
  const sub = user.subscription;
  const candidates = [now];
  if (sub?.status === 'active' && sub.expiresAt > now) candidates.push(sub.expiresAt);
  if (user.trialEndsAt > now) candidates.push(user.trialEndsAt);
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

/** Turns on (or extends) premium for `months`. Mutates and saves the user; returns { start, end }. */
export async function activateSubscription(user, { plan, months }) {
  const start = periodBase(user);
  const end = addMonths(start, months);
  user.subscription = { plan, status: 'active', expiresAt: end };
  await user.save();
  return { start, end };
}

// ---- Payment settings (numbers students send money to) ----

// personal → student uses "Send Money"; merchant → "Payment".
const ACCOUNT_TYPES = ['personal', 'merchant'];

function defaults() {
  return {
    bkash: { number: env.BKASH_NUMBER, type: env.BKASH_ACCOUNT_TYPE, enabled: Boolean(env.BKASH_NUMBER) },
    nagad: { number: env.NAGAD_NUMBER, type: env.NAGAD_ACCOUNT_TYPE, enabled: Boolean(env.NAGAD_NUMBER) },
    note: '',
  };
}

/** Admin-edited values (Setting "payment") over the .env defaults. */
export async function getPaymentSettings() {
  const saved = (await Setting.findOne({ key: 'payment' }).lean())?.value ?? {};
  const base = defaults();
  return {
    bkash: { ...base.bkash, ...saved.bkash },
    nagad: { ...base.nagad, ...saved.nagad },
    note: saved.note ?? base.note,
  };
}

export async function savePaymentSettings(value, adminId) {
  await Setting.updateOne({ key: 'payment' }, { $set: { value, updatedBy: adminId } }, { upsert: true });
  return getPaymentSettings();
}

/** Methods a student can pay with right now (enabled and has a number). */
export async function availableMethods() {
  const s = await getPaymentSettings();
  const methods = ['bkash', 'nagad']
    .filter((m) => s[m].enabled && s[m].number)
    .map((m) => ({ key: m, number: s[m].number, type: ACCOUNT_TYPES.includes(s[m].type) ? s[m].type : 'personal' }));
  return { methods, note: s.note };
}

export { ACCOUNT_TYPES };
