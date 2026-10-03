// Seeds chapters, topics and the question bank from /content into MongoDB (idempotent upsert by slug/key).
// Usage: npm run seed            — upsert everything
//        npm run seed -- --prune  — also delete topics no longer in the syllabus
//        npm run seed -- --overwrite-edits — also overwrite questions an admin fixed in the browser
//        (by default they are kept; `npm run export-edits` prints them so the fix can be copied into content/)
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Chapter } from '../src/models/Chapter.js';
import { Topic } from '../src/models/Topic.js';
import { Question } from '../src/models/Question.js';
import { CQ_PART_MARKS } from '../src/config/exams.js';

const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../content');
const prune = process.argv.includes('--prune');
const overwriteEdits = process.argv.includes('--overwrite-edits');

const loadLesson = (chapterNumber, slug) => loadModule(path.join(CONTENT_DIR, 'topics', `ch${chapterNumber}`, `${slug}.js`));

async function loadModule(file) {
  if (!existsSync(file)) return null;
  return (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)).default;
}

/** Validates one question file entry and returns the DB document (throws with a precise location on bad data). */
function toQuestionDoc(q, type, { key, chapter, chapterNumber, topic }) {
  const where = `question ${key}`;
  const base = {
    key,
    type,
    chapter,
    chapterNumber,
    topic: topic ?? null,
    difficulty: q.difficulty ?? 'medium',
    source: q.source ?? { kind: 'practice' },
    stimulus: q.stimulus,
    figure: q.figure,
    active: true,
  };
  if (type === 'mcq') {
    if (!q.q || q.options?.length !== 4) throw new Error(`${where}: needs q and 4 options`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) throw new Error(`${where}: answer must be 0-3`);
    if (!q.explain) throw new Error(`${where}: explain is required`);
    if (q.why && q.why.length !== 4) throw new Error(`${where}: why must have 4 entries`);
    return { ...base, q: q.q, options: q.options, answer: q.answer, explain: q.explain, why: q.why };
  }
  if (!q.stimulus || q.parts?.length !== 4) throw new Error(`${where}: CQ needs stimulus and 4 parts (ক খ গ ঘ)`);
  q.parts.forEach((p, i) => {
    if (!p.q || !p.answer) throw new Error(`${where}: part ${i} needs q and answer`);
  });
  return { ...base, parts: q.parts.map((p, i) => ({ q: p.q, marks: CQ_PART_MARKS[i], answer: p.answer, rubric: p.rubric ?? [] })) };
}

/** Upserts content/questions/ch<N>/<slug>.js (and _chapter.js for chapter-level questions). */
async function seedQuestions(chapter, topicIds, seen, keptEdits) {
  let n = 0;
  const edited = overwriteEdits
    ? new Set()
    : new Set((await Question.find({ chapter: chapter._id, 'adminEdit.at': { $exists: true } }).select('key').lean()).map((q) => q.key));
  const files = [...topicIds.keys(), '_chapter'];
  for (const slug of files) {
    const bank = await loadModule(path.join(CONTENT_DIR, 'questions', `ch${chapter.number}`, `${slug}.js`));
    if (!bank) continue;
    const ids = new Set(); // ids are unique per file across MCQ and CQ
    for (const type of ['mcq', 'cq']) {
      for (const q of bank[type] ?? []) {
        if (!q.id || ids.has(q.id)) throw new Error(`ch${chapter.number}/${slug}: missing or duplicate id "${q.id}"`);
        ids.add(q.id);
        const key = `ch${chapter.number}/${slug}/${q.id}`;
        const doc = toQuestionDoc(q, type, { key, chapter: chapter._id, chapterNumber: chapter.number, topic: topicIds.get(slug) });
        const unset = Object.fromEntries(Object.keys(doc).filter((k) => doc[k] === undefined).map((k) => [k, 1]));
        for (const k of Object.keys(unset)) delete doc[k];
        seen.add(key);
        n += 1;
        if (edited.has(key)) {
          keptEdits.push(key);
          continue;
        }
        if (overwriteEdits) unset.adminEdit = 1;
        await Question.updateOne({ key }, { $set: doc, ...(Object.keys(unset).length && { $unset: unset }) }, { upsert: true });
      }
    }
  }
  return n;
}

async function main() {
  const { CHAPTERS } = await import(pathToFileURL(path.join(CONTENT_DIR, 'syllabus.js')).href);
  await connectDB();
  let published = 0;
  let total = 0;
  let questions = 0;
  const seenQuestions = new Set();
  const keptEdits = [];

  for (const { topics, ...meta } of CHAPTERS) {
    const chapter = await Chapter.findOneAndUpdate({ number: meta.number }, { $set: meta }, { upsert: true, returnDocument: 'after' });
    const slugs = [];
    const topicIds = new Map();

    for (const [i, t] of topics.entries()) {
      const lesson = await loadLesson(meta.number, t.slug);
      const doc = {
        ...t,
        chapter: chapter._id,
        chapterNumber: meta.number,
        order: i + 1,
        isFree: Boolean(t.isFree),
        important: Boolean(t.important),
        published: Boolean(lesson),
        summary: lesson?.summary ?? t.summary ?? '',
        blocks: lesson?.blocks ?? [],
        keyTerms: lesson?.keyTerms ?? [],
        audioUrl: lesson?.audioUrl,
      };
      const saved = await Topic.findOneAndUpdate({ chapter: chapter._id, slug: t.slug }, { $set: doc }, { upsert: true, returnDocument: 'after' });
      topicIds.set(t.slug, saved._id);
      slugs.push(t.slug);
      total += 1;
      if (lesson) published += 1;
    }

    if (prune) {
      const { deletedCount } = await Topic.deleteMany({ chapter: chapter._id, slug: { $nin: slugs } });
      if (deletedCount) console.log(`  pruned ${deletedCount} stale topic(s) from chapter ${meta.number}`);
    }
    const nq = await seedQuestions(chapter, topicIds, seenQuestions, keptEdits);
    questions += nq;
    console.log(`✔ Chapter ${meta.number}: ${topics.length} topics, ${nq} questions`);
  }

  // Questions removed from content are deactivated, not deleted, so old attempts still render.
  const { modifiedCount } = await Question.updateMany({ key: { $nin: [...seenQuestions] }, active: true }, { $set: { active: false } });
  if (keptEdits.length) {
    console.log(`⚠ Kept ${keptEdits.length} admin-edited question(s) (run "npm run export-edits" to copy the fixes into content/):`);
    for (const k of keptEdits) console.log(`  · ${k}`);
  }
  console.log(`Done — ${total} topics, ${published} published, ${questions} questions${modifiedCount ? `, ${modifiedCount} deactivated` : ''}.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
