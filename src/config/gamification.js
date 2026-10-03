// Levels, streak freezes and badge definitions. Earned badges are stored on the user (key + date);
// everything else lives here so titles/targets can change without a migration.

// ---- Levels: level n starts at 50·(n−1)² XP (L2 = 50, L3 = 200, L5 = 800, L10 = 4050) ----
export const levelFromXp = (xp) => Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;
export const xpForLevel = (level) => 50 * (level - 1) ** 2;

const LEVEL_TITLES = [
  [15, 'কিংবদন্তি'],
  [12, 'মাস্টার'],
  [10, 'বিশেষজ্ঞ'],
  [8, 'দক্ষ'],
  [6, 'অধ্যবসায়ী'],
  [4, 'অনুসন্ধানী'],
  [2, 'শিক্ষানবিশ'],
  [1, 'নবীন'],
];

export function levelInfo(xp) {
  const level = levelFromXp(xp);
  return {
    level,
    title: LEVEL_TITLES.find(([min]) => level >= min)[1],
    from: xpForLevel(level),
    to: xpForLevel(level + 1),
  };
}

// ---- Streak freezes: one is earned for every 7 days in a row, at most MAX can be saved ----
export const STREAK_FREEZE = { every: 7, max: 2 };

// ---- Badges ----
// metric = a number from services/badges.js computeStats(); earned when stats[metric] >= target.
// tier only changes the colour (bronze / silver / gold).
const chapterMaster = (n) => ({
  key: `chapter-${n}-master`,
  group: 'chapter',
  title: `অধ্যায় ${'০১২৩৪৫৬'[n]} মাস্টার`,
  desc: 'অধ্যায়ের সব টপিক শেষ এবং অধ্যায় পরীক্ষায় ৮০%+',
  icon: 'Crown',
  tier: 'gold',
  metric: `chapter${n}Master`,
  target: 1,
});

export const BADGES = [
  // streak
  { key: 'streak-3', group: 'streak', title: 'শুরুটা দারুণ', desc: 'টানা ৩ দিন পড়েছ', icon: 'Flame', tier: 'bronze', metric: 'streakLongest', target: 3 },
  { key: 'streak-7', group: 'streak', title: 'এক সপ্তাহ টানা', desc: 'টানা ৭ দিন পড়েছ', icon: 'Flame', tier: 'silver', metric: 'streakLongest', target: 7 },
  { key: 'streak-30', group: 'streak', title: 'মাসজুড়ে অবিরাম', desc: 'টানা ৩০ দিন পড়েছ', icon: 'Flame', tier: 'gold', metric: 'streakLongest', target: 30 },
  { key: 'streak-100', group: 'streak', title: 'শতদিনের সাধক', desc: 'টানা ১০০ দিন পড়েছ', icon: 'Flame', tier: 'gold', metric: 'streakLongest', target: 100 },
  // reading
  { key: 'first-topic', group: 'learn', title: 'প্রথম পদক্ষেপ', desc: 'প্রথম টপিক শেষ করেছ', icon: 'BookOpen', tier: 'bronze', metric: 'topicsDone', target: 1 },
  { key: 'topics-10', group: 'learn', title: 'বইপোকা', desc: '১০টি টপিক শেষ', icon: 'BookOpen', tier: 'silver', metric: 'topicsDone', target: 10 },
  { key: 'topics-30', group: 'learn', title: 'অর্ধেক পথ', desc: '৩০টি টপিক শেষ', icon: 'BookOpen', tier: 'silver', metric: 'topicsDone', target: 30 },
  { key: 'all-topics', group: 'learn', title: 'পুরো বই শেষ', desc: 'সব টপিক শেষ করেছ', icon: 'GraduationCap', tier: 'gold', metric: 'topicsLeft0', target: 1 },
  { key: 'study-10h', group: 'learn', title: '১০ ঘণ্টার সাধনা', desc: 'মোট ১০ ঘণ্টা পড়েছ', icon: 'Clock', tier: 'silver', metric: 'studyHours', target: 10 },
  { key: 'study-50h', group: 'learn', title: '৫০ ঘণ্টার সাধনা', desc: 'মোট ৫০ ঘণ্টা পড়েছ', icon: 'Clock', tier: 'gold', metric: 'studyHours', target: 50 },
  { key: 'goal-7', group: 'learn', title: 'লক্ষ্যে অটল', desc: '৭ দিন দৈনিক পড়ার লক্ষ্য পূরণ', icon: 'Target', tier: 'silver', metric: 'goalDays', target: 7 },
  // tests
  { key: 'quiz-10', group: 'exam', title: 'পরীক্ষার্থী', desc: '১০টি কুইজ/পরীক্ষা দিয়েছ', icon: 'ClipboardCheck', tier: 'bronze', metric: 'testsTaken', target: 10 },
  { key: 'quiz-50', group: 'exam', title: 'অভিজ্ঞ পরীক্ষার্থী', desc: '৫০টি কুইজ/পরীক্ষা দিয়েছ', icon: 'ClipboardCheck', tier: 'silver', metric: 'testsTaken', target: 50 },
  { key: 'perfect-quiz', group: 'exam', title: 'নিখুঁত', desc: 'একটি টপিক কুইজের সব MCQ সঠিক', icon: 'Sparkles', tier: 'bronze', metric: 'perfectQuizzes', target: 1 },
  { key: 'perfect-10', group: 'exam', title: 'নিখুঁতের ধারা', desc: '১০টি ভিন্ন টপিক কুইজের সব MCQ সঠিক', icon: 'Sparkles', tier: 'gold', metric: 'perfectQuizzes', target: 10 },
  { key: 'chapter-aplus', group: 'exam', title: 'A+ এর স্বাদ', desc: 'যেকোনো অধ্যায় পরীক্ষায় ৮০%+', icon: 'Award', tier: 'silver', metric: 'chapterAplus', target: 1 },
  { key: 'model-aplus', group: 'exam', title: 'বোর্ডের জন্য তৈরি', desc: 'পূর্ণাঙ্গ MCQ মডেল টেস্টে ৮০%+', icon: 'Award', tier: 'gold', metric: 'fullAplus', target: 1 },
  { key: 'mistakes-10', group: 'exam', title: 'ভুল থেকে শেখা', desc: 'ভুলের খাতা থেকে ১০টি প্রশ্ন আয়ত্ত', icon: 'NotebookTabs', tier: 'bronze', metric: 'mistakesFixed', target: 10 },
  { key: 'mistakes-50', group: 'exam', title: 'ভুলজয়ী', desc: 'ভুলের খাতা থেকে ৫০টি প্রশ্ন আয়ত্ত', icon: 'NotebookTabs', tier: 'gold', metric: 'mistakesFixed', target: 50 },
  // chapters
  ...[1, 2, 3, 4, 5, 6].map(chapterMaster),
  // XP
  { key: 'xp-1000', group: 'xp', title: 'হাজারী', desc: '১,০০০ XP অর্জন', icon: 'Zap', tier: 'silver', metric: 'xp', target: 1000 },
  { key: 'xp-5000', group: 'xp', title: 'পাঁচ হাজারী', desc: '৫,০০০ XP অর্জন', icon: 'Zap', tier: 'gold', metric: 'xp', target: 5000 },
  // study plan
  { key: 'plan-7', group: 'habit', title: 'পরিকল্পনামাফিক', desc: '৭ দিন স্টাডি প্ল্যানের সব কাজ সেদিনই শেষ', icon: 'CalendarCheck', tier: 'silver', metric: 'planDays', target: 7 },
  { key: 'plan-30', group: 'habit', title: 'নিয়মের রাজা', desc: '৩০ দিন স্টাডি প্ল্যানের সব কাজ সেদিনই শেষ', icon: 'CalendarCheck', tier: 'gold', metric: 'planDays', target: 30 },
  // habits (earned at the moment of studying, Bangladesh time)
  { key: 'night-owl', group: 'habit', title: 'রাতজাগা পাখি', desc: 'রাত ১২টা থেকে ৪টার মধ্যে পড়েছ', icon: 'Moon', tier: 'bronze', metric: 'nightOwl', target: 1 },
  { key: 'early-bird', group: 'habit', title: 'ভোরের পাখি', desc: 'ভোর ৪টা থেকে ৭টার মধ্যে পড়েছ', icon: 'Sunrise', tier: 'bronze', metric: 'earlyBird', target: 1 },
];

export const BADGE_MAP = new Map(BADGES.map((b) => [b.key, b]));
export const CHAPTER_A_PLUS = 80; // percent
