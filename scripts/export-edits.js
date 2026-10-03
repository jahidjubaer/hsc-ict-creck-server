// Prints questions an admin edited in the browser, in the same shape as content/questions files,
// so the fixes can be copied back into content/ (after that, `npm run seed -- --overwrite-edits`).
// Usage: npm run export-edits            (add --json for raw JSON)
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Question } from '../src/models/Question.js';

await connectDB();
const edited = await Question.find({ 'adminEdit.at': { $exists: true } }).sort({ key: 1 }).lean();
const out = edited.map((q) => {
  const id = q.key.split('/').pop();
  const base = { file: `content/questions/${q.key.split('/').slice(0, 2).join('/')}.js`, id, editedAt: q.adminEdit.at, active: q.active };
  if (q.type === 'mcq') {
    return { ...base, type: 'mcq', difficulty: q.difficulty, stimulus: q.stimulus, q: q.q, options: q.options, answer: q.answer, explain: q.explain, why: q.why };
  }
  return { ...base, type: 'cq', difficulty: q.difficulty, stimulus: q.stimulus, parts: q.parts.map(({ q: pq, answer, rubric }) => ({ q: pq, answer, rubric })) };
});
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
else if (!out.length) console.log('No admin-edited questions.');
else for (const q of out) console.log(`\n// ${q.file} → id "${q.id}" (${q.type}, edited ${q.editedAt.toISOString()})\n${JSON.stringify(q, null, 2)}`);
await mongoose.disconnect();
