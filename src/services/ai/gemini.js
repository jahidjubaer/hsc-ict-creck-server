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

/** Google Gemini (free tier) via REST — returns the parsed JSON reply. */
export async function geminiJson({ system, prompt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error(`Gemini returned no text (${data.candidates?.[0]?.finishReason ?? 'unknown'})`);
  return JSON.parse(text);
}
