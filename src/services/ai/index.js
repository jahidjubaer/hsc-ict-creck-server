import { env } from '../../config/env.js';
import { geminiJson } from './gemini.js';
import { anthropicJson } from './anthropic.js';
import { SYSTEM_PROMPT, buildGradingPrompt, normalizeGrades } from './prompt.js';

// AI_PROVIDER=gemini|anthropic|none, or auto (first configured key wins, Gemini first).
function pickProvider() {
  const p = env.AI_PROVIDER;
  if (p === 'none') return null;
  if ((p === 'gemini' || p === 'auto') && env.GEMINI_API_KEY) return { name: 'gemini', model: env.GEMINI_MODEL, call: geminiJson };
  if ((p === 'anthropic' || p === 'auto') && env.ANTHROPIC_API_KEY) return { name: 'anthropic', model: env.AI_GRADER_MODEL, call: anthropicJson };
  return null;
}

export const aiAvailable = () => Boolean(pickProvider());

/**
 * Grades one CQ. `answers` = the student's text per part.
 * Returns { parts: [{ score, feedback, missing }], model }; throws if the provider keeps failing.
 */
export async function gradeCq({ question, answers, chapterTitle }) {
  const provider = pickProvider();
  if (!provider) throw new Error('AI grader not configured');
  const prompt = buildGradingPrompt({ question, answers, chapterTitle });

  let lastErr;
  for (let tryNo = 0; tryNo < 2; tryNo += 1) {
    try {
      const raw = await provider.call({ system: SYSTEM_PROMPT, prompt });
      return { parts: normalizeGrades(raw, question, answers), model: `${provider.name}:${provider.model}` };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
