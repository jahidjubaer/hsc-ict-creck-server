// Exam templates. Kept in config so marks/timings can follow the board if the pattern changes.
// HSC ICT theory: MCQ 25 (25 min) + CQ 50 (any 5 of 8, 10 marks each; ক1 খ2 গ3 ঘ4).
// MCQ and CQ are separate tests at every level (topic, chapter, full book); `level` decides scope, gating and paywall.

export const CQ_PART_MARKS = [1, 2, 3, 4];
export const CQ_PART_LABELS = ['ক', 'খ', 'গ', 'ঘ'];

export const EXAMS = {
  // After each topic: 10 MCQs one at a time with instant feedback.
  topic: { level: 'topic', part: 'mcq', title: 'টপিক MCQ কুইজ', mcq: 10, cq: 0, cqChoose: 0, timeLimitMin: null, instant: true, maxXp: 20, minMcq: 3 },
  // After each topic: one creative question, graded by the AI examiner (or self-marked).
  'topic-cq': { level: 'topic', part: 'cq', title: 'টপিক সৃজনশীল অনুশীলন', mcq: 0, cq: 1, cqChoose: 1, timeLimitMin: null, instant: false, maxXp: 15, minCq: 1 },
  // Chapter tests in the board's timing: 25 MCQs in 25 minutes; CQ any 2 of 3 in 50 minutes (25 min per CQ).
  'chapter-mcq': { level: 'chapter', part: 'mcq', title: 'অধ্যায় MCQ পরীক্ষা', mcq: 25, cq: 0, cqChoose: 0, timeLimitMin: 25, instant: false, maxXp: 60, minMcq: 10 },
  'chapter-cq': { level: 'chapter', part: 'cq', title: 'অধ্যায় সৃজনশীল পরীক্ষা', mcq: 0, cq: 3, cqChoose: 2, timeLimitMin: 50, instant: false, maxXp: 60, minCq: 2 },
  // Full-book model tests in the board pattern.
  full: { level: 'full', part: 'mcq', title: 'পূর্ণাঙ্গ MCQ মডেল টেস্ট', mcq: 25, cq: 0, cqChoose: 0, timeLimitMin: 25, instant: false, maxXp: 60, minMcq: 25 },
  'full-cq': { level: 'full', part: 'cq', title: 'পূর্ণাঙ্গ সৃজনশীল মডেল টেস্ট', mcq: 0, cq: 8, cqChoose: 5, timeLimitMin: 150, instant: false, maxXp: 100, minCq: 5 },
  // Older combined chapter test (MCQ + CQ). Kept so past attempts still open; new ones can't be started.
  chapter: { level: 'chapter', part: 'both', legacy: true, title: 'অধ্যায় পরীক্ষা', mcq: 25, cq: 3, cqChoose: 2, timeLimitMin: 75, instant: false, maxXp: 100, minMcq: 10 },
};

export const EXAM_KINDS = Object.keys(EXAMS);
/** Kinds a student can start now. */
export const START_KINDS = EXAM_KINDS.filter((k) => !EXAMS[k].legacy);
/** Kinds that count as "the chapter test" for badges and the study plan (MCQ part; CQ grading is too variable). */
export const CHAPTER_TEST_KINDS = ['chapter-mcq', 'chapter'];

/** True when the picked questions are enough for a meaningful test of this kind. */
export function enoughQuestions(kind, picked) {
  const t = EXAMS[kind];
  return (!t.mcq || picked.mcq.length >= t.minMcq) && (!t.cq || picked.cq.length >= t.minCq);
}

/** Seconds of grace after the deadline for network delay on submit. */
export const SUBMIT_GRACE_SEC = 60;

/** Soft-gating: topic tests after reading the topic, chapter tests after finishing all published topics. */
export const GATING = { topicQuiz: true, chapterTest: true };
