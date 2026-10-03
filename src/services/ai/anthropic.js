import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';

let client;

const GRADES_TOOL = {
  name: 'submit_grades',
  description: 'Submit marks and feedback for each answered part.',
  input_schema: {
    type: 'object',
    properties: {
      parts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            part: { type: 'integer' },
            score: { type: 'integer' },
            feedback: { type: 'string' },
            missing: { type: 'array', items: { type: 'string' } },
          },
          required: ['part', 'score', 'feedback'],
        },
      },
    },
    required: ['parts'],
  },
};

/** Claude via a forced tool call, so the reply is always structured. */
export async function anthropicJson({ system, prompt }) {
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: env.AI_GRADER_MODEL,
    max_tokens: 2000,
    system,
    tools: [GRADES_TOOL],
    tool_choice: { type: 'tool', name: GRADES_TOOL.name },
    messages: [{ role: 'user', content: prompt }],
  });
  const block = msg.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('Claude returned no grades');
  return block.input;
}
