import { env } from '../../config/env.js';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    parts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          part: { type: 'INTEGER' },
          score: { type: 'INTEGER' },
          feedback: { type: 'STRING' },
          missing: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['part', 'score', 'feedback'],
      },
    },
  },
  required: ['parts'],
};

const RETRY_STATUS = new Set([429, 500, 503]); // rate limit / overloaded — usually gone within seconds
const RETRY_DELAYS_MS = [2000, 5000];
// One CQ gets at most this long in total (calls + waits), well inside the 120 s function limit (vercel.json);
// past it the student self-marks instead of losing the submission to a timeout.
const TOTAL_BUDGET_MS = 75_000;
const MIN_CALL_MS = 15_000; // don't start a retry that can't finish
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Google Gemini (free tier) via REST — returns the parsed JSON reply. Retries briefly when the model is busy. */
export async function geminiJson({ system, prompt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`;
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      signal: AbortSignal.timeout(Math.max(MIN_CALL_MS, deadline - Date.now())),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
      }),
    });
    const delay = RETRY_DELAYS_MS[attempt];
    if (!res.ok && RETRY_STATUS.has(res.status) && delay && deadline - Date.now() > delay + MIN_CALL_MS) {
      await sleep(delay);
      continue;
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) throw new Error(`Gemini returned no text (${data.candidates?.[0]?.finishReason ?? 'unknown'})`);
    return JSON.parse(text);
  }
}
