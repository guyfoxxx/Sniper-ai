import { z } from 'zod';

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(10),

  // Optional integrations
  NEWSAPI_KEY: z.string().optional(),
  GOOGLE_CSE_API_KEY: z.string().optional(),
  GOOGLE_CSE_CX: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TEXT_MODEL: z.string().optional(),
  OPENAI_VISION_MODEL: z.string().optional(),
  OPENAI_IMAGE_MODEL: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_TEXT_MODEL: z.string().optional(),

  NANOBANANA_API_URL: z.string().optional(),
  NANOBANANA_API_KEY: z.string().optional(),

  HF_API_URL: z.string().optional(),
  HF_API_KEY: z.string().optional(),

  CF_TEXT_MODEL: z.string().optional(),
  CF_VISION_MODEL: z.string().optional(),
  CF_IMAGE_MODEL: z.string().optional(),
  CF_GEMMA_MODEL: z.string().optional(),

  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),

  MEMORY_MAX_TURNS: z.string().optional(),
  MEMORY_SUMMARY_TRIGGER: z.string().optional(),
});

export type WorkerEnv = z.infer<typeof EnvSchema> & {
  AI: Ai;
  MEMORY: DurableObjectNamespace;
  KV?: KVNamespace;
};

export function parseEnv(env: Record<string, unknown>): WorkerEnv {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Env validation failed: ${msg}`);
  }
  return env as WorkerEnv;
}

export function numEnv(envVal: string | undefined, fallback: number): number {
  const n = Number(envVal);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
