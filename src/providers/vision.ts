import type { WorkerEnv } from '../env';

type VisionOpts = { maxTokens?: number };

function cfVisionModel(env: WorkerEnv) {
  return env.CF_VISION_MODEL || '@cf/llava-hf/llava-1.5-7b-hf';
}

export async function analyzeChartImage(env: WorkerEnv, imageUrl: string, question: string, opts: VisionOpts = {}) {
  const maxTokens = opts.maxTokens ?? 900;

  // 1) OpenAI Vision
  if (env.OPENAI_API_KEY) {
    try {
      const model = env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are a market chart analyst. Describe structure, trend, key levels, patterns. Provide educational analysis only.',
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: question },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            },
          ],
          max_tokens: maxTokens,
          temperature: 0.2,
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

  // 2) Cloudflare LLaVA
  try {
    const model = cfVisionModel(env);
    // Workers AI expects the image as a data URL or bytes; simplest: fetch and convert to ArrayBuffer
    const imgRes = await fetch(imageUrl);
    if (imgRes.ok) {
      const bytes = await imgRes.arrayBuffer();
      const r: any = await env.AI.run(model as any, {
        image: [...new Uint8Array(bytes)],
        prompt: question,
        max_tokens: maxTokens,
      });
      const t = r?.description ?? r?.response ?? r?.result ?? r?.text;
      if (typeof t === 'string' && t.trim()) return t.trim();
    }
  } catch (_) {
    // continue
  }

  // 3) HuggingFace endpoint (your own)
  if (env.HF_API_URL && env.HF_API_KEY) {
    try {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error('image fetch failed');
      const blob = await imgRes.blob();

      const form = new FormData();
      form.set('file', blob, 'chart.jpg');
      form.set('question', question);

      const res = await fetch(env.HF_API_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.HF_API_KEY}` },
        body: form,
      });
      if (res.ok) {
        const t = await res.text();
        if (t.trim()) return t.trim();
      }
    } catch (_) {
      // ignore
    }
  }

  return 'تحلیل تصویر در دسترس نیست (کلیدهای Vision تنظیم نشده یا مدل‌ها خطا دادند).';
}
