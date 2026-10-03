// Exam templates. Kept in config so marks/timings can follow the board if the pattern changes.
// HSC ICT theory: MCQ 25 (25 min) + CQ 50 (any 5 of 8, 10 marks each; ক1 খ2 গ3 ঘ4).

export const CQ_PART_MARKS = [1, 2, 3, 4];
export const CQ_PART_LABELS = ['ক', 'খ', 'গ', 'ঘ'];

export const EXAMS = {
  // Short practice after each topic: one question at a time with instant feedback.
  topic: { title: 'টপিক কুইজ', mcq: 10, cq: 1, cqChoose: 1, timeLimitMin: null, instant: true, maxXp: 30 },
  // Board-style chapter test: timed, answers revealed after submit.
  chapter: { title: 'অধ্যায় পরীক্ষা', mcq: 25, cq: 3, cqChoose: 2, timeLimitMin: 25 + 50, instant: false, maxXp: 100 },
  // Full-book MCQ model test (board pattern: 25 questions in 25 minutes).
  full: { title: 'পূর্ণাঙ্গ MCQ মডেল টেস্ট', mcq: 25, cq: 0, cqChoose: 0, timeLimitMin: 25, instant: false, maxXp: 60 },
};

export const EXAM_KINDS = Object.keys(EXAMS);

/** Minimum MCQs needed before a test can be generated. */
export const MIN_MCQ = { topic: 3, chapter: 10, full: 25 };

/** Seconds of grace after the deadline for network delay on submit. */
export const SUBMIT_GRACE_SEC = 60;

/** Soft-gating: quiz after reading the topic, chapter test after finishing all published topics. */
export const GATING = { topicQuiz: true, chapterTest: true };
