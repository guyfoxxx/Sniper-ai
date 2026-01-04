import type { WorkerEnv } from '../env';

type LlmOpts = {
  temperature?: number;
  maxTokens?: number;
};

function cfModel(env: WorkerEnv) {
  return env.CF_TEXT_MODEL || '@cf/meta/llama-3.1-70b-instruct';
}

export async function callTextLLM(env: WorkerEnv, prompt: string, opts: LlmOpts = {}): Promise<string> {
  // Priority: Cloudflare AI -> OpenAI -> Gemini
  const temperature = opts.temperature ?? 0.4;
  const maxTokens = opts.maxTokens ?? 900;

  // 1) Cloudflare Workers AI
  try {
    const model = cfModel(env);
    const r: any = await env.AI.run(model as any, {
      messages: [
        { role: 'system', content: 'You are a helpful trading analysis assistant. Provide educational analysis.' },
        { role: 'user', content: prompt },
      ],
      temperature,
      max_tokens: maxTokens,
    });
    const text = r?.response ?? r?.result ?? r?.text;
    if (typeof text === 'string' && text.trim()) return text.trim();
  } catch (_) {
    // continue
  }

  // 2) OpenAI
  if (env.OPENAI_API_KEY) {
    try {
      const model = env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are a helpful trading analysis assistant. Provide educational analysis.' },
            { role: 'user', content: prompt },
          ],
          temperature,
          max_tokens: maxTokens,
        }),
      });
      if (res.ok) {
        const j: any = await res.json();
        const t = j?.choices?.[0]?.message?.content;
        if (typeof t === 'string' && t.trim()) return t.trim();
      }
    } catch (_) {
      // continue
    }
  }

  // 3) Gemini
  if (env.GEMINI_API_KEY) {
    try {
      const model = env.GEMINI_TEXT_MODEL || 'gemini-1.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
      });
      if (res.ok) {
        const j: any = await res.json();
        const t = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
        if (typeof t === 'string' && t.trim()) return t.trim();
      }
    } catch (_) {
      // ignore
    }
  }

  return 'متأسفانه هیچ مدل متنی در دسترس نیست یا کلیدها تنظیم نشده‌اند.';
}
