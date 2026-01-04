import type { WorkerEnv } from '../env';
import type { NewsItem } from '../types';

function cfGemmaModel(env: WorkerEnv) {
  return env.CF_GEMMA_MODEL || '@cf/google/gemma-2b-it';
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export async function scoreNewsWithGemma(env: WorkerEnv, items: NewsItem[], query: string): Promise<NewsItem[]> {
  if (!items.length) return items;

  // Always try Gemma on Workers AI first (as requested).
  try {
    const model = cfGemmaModel(env);
    const prompt = [
      'وظیفه: به هر خبر بر اساس ارتباط و اهمیت برای ترید (کریپتو/فارکس) امتیاز 1 تا 10 بده.',
      'معیارها: تاثیر بالقوه روی نوسان، اخبار ماکرو/نرخ بهره، رگولاتوری، ETF، هک/ورود سرمایه، داده‌های تورم/اشتغال، تصمیم بانک مرکزی.',
      'خروجی باید JSON باشد: [{"i":0,"score":7},...]',
      `کوئری/دارایی: ${query}`,
      '',
      'اخبار:',
      ...items.map((it, i) => `${i}. ${it.title} | ${it.source ?? ''} | ${it.snippet ?? ''}`),
    ].join('\n');

    const r: any = await env.AI.run(model as any, {
      messages: [
        { role: 'system', content: 'Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 400,
    });

    const text = (r?.response ?? r?.result ?? r?.text ?? '').toString().trim();
    const jsonText = text.match(/\[[\s\S]*\]/)?.[0] ?? '';
    const arr = JSON.parse(jsonText) as Array<{ i: number; score: number }>;
    const map = new Map(arr.map((x) => [x.i, clamp(Number(x.score) || 1, 1, 10)]));
    return items.map((it, i) => ({ ...it, score: map.get(i) ?? 5 }));
  } catch {
    // fallback heuristic
    const hot = /(fed|rate|inflation|cpi|jobs|bank|sec|etf|hack|exchange|regulat|sanction|war|oil|dollar)/i;
    return items.map((it) => ({
      ...it,
      score: hot.test(`${it.title} ${it.snippet ?? ''}`) ? 8 : 5,
    }));
  }
}
