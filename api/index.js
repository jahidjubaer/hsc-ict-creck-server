// Vercel serverless entry: every request is rewritten here (see vercel.json). The MongoDB connection
// is opened once per instance and reused by later requests; a failed connect is retried on the next one.
import { connectDB } from '../src/config/db.js';
import { createApp } from '../src/app.js';

const app = createApp();
let ready;

export default async function handler(req, res) {
  ready ??= connectDB().catch((err) => {
    ready = undefined;
    throw err;
  });
  await ready;
  return app(req, res);
}
