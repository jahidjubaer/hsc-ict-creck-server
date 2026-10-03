// Subscription plans (prices in BDT). Single source of truth — the client reads these via GET /api/plans.
export const PLANS = [
  { key: 'm1', name: '১ মাস', months: 1, price: 90 },
  { key: 'm3', name: '৩ মাস', months: 3, price: 250 },
  { key: 'm6', name: '৬ মাস', months: 6, price: 350, popular: true },
  { key: 'y1', name: '১ বছর', months: 12, price: 490 },
];

export const PLAN_KEYS = PLANS.map((p) => p.key);
export const findPlan = (key) => PLANS.find((p) => p.key === key);
