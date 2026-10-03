import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  MONGODB_URI: z.string().min(1),
  CLIENT_URL: z.string().default('http://localhost:5180'),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().default(30),
  TRIAL_DAYS: z.coerce.number().default(15),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  AI_GRADER_MODEL: z.string().default('claude-sonnet-5-5'),
  AI_PROVIDER: z.enum(['auto', 'gemini', 'anthropic', 'none']).default('auto'),
  AI_DAILY_LIMIT: z.coerce.number().default(40), // CQs one student can send to the AI examiner per day
  // Default numbers students send money to (the admin panel can change them later)
  BKASH_NUMBER: z.string().optional().default(''),
  BKASH_ACCOUNT_TYPE: z.enum(['personal', 'merchant']).default('personal'),
  NAGAD_NUMBER: z.string().optional().default(''),
  NAGAD_ACCOUNT_TYPE: z.enum(['personal', 'merchant']).default('personal'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:', z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
