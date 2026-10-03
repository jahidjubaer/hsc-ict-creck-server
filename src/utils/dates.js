// All "day" logic (streaks, daily activity, study plans) uses Bangladesh time.
export const TZ = 'Asia/Dhaka';

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Returns YYYY-MM-DD for the given date in Asia/Dhaka. */
export function dhakaDay(date = new Date()) {
  return dayFmt.format(date);
}

/** Whole-day difference between two YYYY-MM-DD strings (b - a). */
export function dayDiff(a, b) {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * 86_400_000);
}

const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });

/** Hour of day (0–23) in Asia/Dhaka. */
export function dhakaHour(date = new Date()) {
  return Number(hourFmt.format(date));
}
