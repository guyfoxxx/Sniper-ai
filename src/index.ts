import { parseEnv, type WorkerEnv } from './env';
import { MemoryDO } from './memory_do';
import { tgSendMessage, tgSendPhoto, tgGetFileUrl, fetchAsBlob, pickBestPhotoFileId } from './utils/telegram';
import { formatHelp, formatNews, extractMarketAndTimeframe } from './utils/format';
import { fetchRelevantNews } from './providers/news';
import { analyzeChartImage } from './providers/vision';
import { callTextLLM } from './providers/llm';
import { buildSignalPrompt, buildSignalCardImagePrompt } from './prompt';
import { generateSignalImage } from './providers/image';
import type { MemoryState } from './memory_do';

export { MemoryDO };

function getMemoryStub(env: WorkerEnv, chatId: string) {
  const id = env.MEMORY.idFromName(chatId);
  return env.MEMORY.get(id);
}

async function memGet(env: WorkerEnv, chatId: string): Promise<MemoryState> {
  const stub = getMemoryStub(env, chatId);
  const res = await stub.fetch('https://do/get', { method: 'GET' });
  return (await res.json()) as MemoryState;
}

async function memAppend(env: WorkerEnv, chatId: string, role: 'user' | 'assistant', content: string) {
  const stub = getMemoryStub(env, chatId);
  await stub.fetch('https://do/append', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, content }),
  });
}

async function memReset(env: WorkerEnv, chatId: string) {
  const stub = getMemoryStub(env, chatId);
  await stub.fetch('https://do/reset', { method: 'POST' });
}

async function memSetVision(env: WorkerEnv, chatId: string, vision: string) {
  const stub = getMemoryStub(env, chatId);
  await stub.fetch('https://do/setVision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ vision }),
  });
}

function isValidWebhook(req: Request, env: WorkerEnv) {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return false;
  // /telegram/<secret>
  return parts[0] === 'telegram' && parts[1] === env.TELEGRAM_WEBHOOK_SECRET;
}

function getMessage(update: any) {
  return update?.message ?? update?.edited_message ?? update?.channel_post ?? update?.edited_channel_post ?? null;
}

function getChatId(msg: any): string {
  return String(msg?.chat?.id ?? msg?.from?.id ?? 'unknown');
}

function getText(msg: any): string {
  return msg?.text ?? msg?.caption ?? '';
}

async function handleCommand(env: WorkerEnv, msg: any) {
  const chatId = getChatId(msg);
  const text = getText(msg).trim();
  const cmd = text.split(/\s+/)[0]?.toLowerCase();

  if (cmd === '/start' || cmd === '/help') {
    await tgSendMessage(env, chatId, formatHelp());
    return;
  }

  if (cmd === '/reset') {
    await memReset(env, chatId);
    await tgSendMessage(env, chatId, '✅ حافظه پاک شد.');
    return;
  }

  if (cmd === '/news') {
    const q = text.split(/\s+/).slice(1).join(' ').trim() || 'bitcoin';
    const news = await fetchRelevantNews(env, q);
    await tgSendMessage(env, chatId, formatNews(news));
    return;
  }

  if (cmd === '/signal') {
    const { market, timeframe } = extractMarketAndTimeframe(text);
    await tgSendMessage(env, chatId, '⏳ در حال جمع‌آوری خبر و ساخت تحلیل آموزشی...');

    const mem = await memGet(env, chatId);
    const newsQ = `${market} crypto forex`;
    const news = await fetchRelevantNews(env, newsQ);

    const prompt = buildSignalPrompt({
      market,
      timeframe,
      userText: text,
      memorySummary: mem.summary,
      recentMessages: mem.messages,
      vision: mem.lastVision ?? null,
      news,
      userPrompt: mem.userPrompt,
    });

    const answer = await callTextLLM(env, prompt, { temperature: 0.35, maxTokens: 1000 });

    await memAppend(env, chatId, 'user', text);
    await memAppend(env, chatId, 'assistant', answer);

    await tgSendMessage(env, chatId, withDisclaimer(answer));

    // Try to extract a short "signal card" for image generation
    const cardText = extractSignalCard(answer);
    if (cardText) {
      const imgPrompt = buildSignalCardImagePrompt(cardText, market);
      const img = await generateSignalImage(env, { prompt: imgPrompt, size: '1024x1024' });
      if (img) {
        await tgSendPhoto(env, chatId, img, '🖼️ کارت سیگنال (آموزشی)');
      }
    }
    return;
  }

  // Unknown command
  if (cmd?.startsWith('/')) {
    await tgSendMessage(env, chatId, 'دستور نامعتبر است. /help را بزنید.');
  }
}

function withDisclaimer(text: string) {
  const d =
    '\n\n⚠️ <b>هشدار</b>: این تحلیل صرفاً آموزشی است و توصیه مالی/سرمایه‌گذاری نیست. قبل از هر معامله تحقیق کنید.';
  // keep telegram message size reasonable
  return (text || '').slice(0, 3500) + d;
}

function extractSignalCard(answer: string): string | null {
  // Heuristic: find section "کارت سیگنال" or last 4 lines
  const m = answer.match(/کارت\s*سیگنال[\s\S]*$/i);
  if (m?.[0]) {
    const t = m[0].split('\n').slice(0, 8).join('\n').trim();
    return t.length > 20 ? t : null;
  }
  const lines = answer.split('\n').map((x) => x.trim()).filter(Boolean);
  if (lines.length >= 4) {
    const t = lines.slice(-4).join('\n').trim();
    return t.length > 20 ? t : null;
  }
  return null;
}

async function handlePhoto(env: WorkerEnv, msg: any) {
  const chatId = getChatId(msg);
  const caption = (msg?.caption ?? '').trim();
  const fileId = pickBestPhotoFileId(msg);
  if (!fileId) {
    await tgSendMessage(env, chatId, 'عکس معتبر دریافت نشد.');
    return;
  }

  await tgSendMessage(env, chatId, '📷 عکس دریافت شد. در حال تحلیل چارت...');

  const fileUrl = await tgGetFileUrl(env, fileId);

  // Vision question - you can tune this later
  const q = [
    'این یک تصویر از چارت است.',
    'لطفاً روند کلی، ساختار (رنج/ترند)، سطوح حمایت/مقاومت، الگوهای احتمالی و نواحی نقدینگی را توضیح بده.',
    'اگر تایم‌فریم یا نماد روی چارت مشخص است بگو.',
    'در انتها یک سناریوی صعودی و نزولی آموزشی پیشنهاد بده.',
    caption ? `توضیح کاربر: ${caption}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const vision = await analyzeChartImage(env, fileUrl, q, { maxTokens: 950 });
  await memSetVision(env, chatId, vision);

  // Now create signal based on memory + news
  const mem = await memGet(env, chatId);
  const marketGuess = guessMarketFromText(caption) || 'BTC';
  const news = await fetchRelevantNews(env, `${marketGuess} crypto forex`);

  const prompt = buildSignalPrompt({
    market: marketGuess,
    timeframe: undefined,
    userText: caption || 'تحلیل بر اساس عکس چارت',
    memorySummary: mem.summary,
    recentMessages: mem.messages,
    vision,
    news,
    userPrompt: mem.userPrompt,
  });

  const answer = await callTextLLM(env, prompt, { temperature: 0.35, maxTokens: 1100 });

  await memAppend(env, chatId, 'user', caption ? `[عکس چارت] ${caption}` : '[عکس چارت]');
  await memAppend(env, chatId, 'assistant', answer);

  await tgSendMessage(env, chatId, withDisclaimer(answer));

  const cardText = extractSignalCard(answer);
  if (cardText) {
    const imgPrompt = buildSignalCardImagePrompt(cardText, marketGuess);
    const img = await generateSignalImage(env, { prompt: imgPrompt, size: '1024x1024' });
    if (img) {
      await tgSendPhoto(env, chatId, img, '🖼️ کارت سیگنال (آموزشی)');
    }
  }
}

function guessMarketFromText(text: string): string | null {
  const t = (text || '').toUpperCase();
  const m = t.match(/\b([A-Z]{3,10}USDT|BTC|ETH|BNB|SOL|XRP|EURUSD|GBPUSD|USDJPY|XAUUSD|NAS100|US30)\b/);
  return m?.[1] ?? null;
}

async function handleText(env: WorkerEnv, msg: any) {
  const chatId = getChatId(msg);
  const text = getText(msg).trim();
  if (!text) return;

  // treat as a normal query: store to memory + answer with LLM using memory + maybe news
  await tgSendMessage(env, chatId, '🧠 در حال فکر کردن...');

  const mem = await memGet(env, chatId);
  const marketGuess = guessMarketFromText(text) || 'BTC';
  const news = await fetchRelevantNews(env, `${marketGuess} crypto forex`);

  const prompt = buildSignalPrompt({
    market: marketGuess,
    timeframe: undefined,
    userText: text,
    memorySummary: mem.summary,
    recentMessages: mem.messages,
    vision: mem.lastVision ?? null,
    news,
    userPrompt: mem.userPrompt,
  });

  const answer = await callTextLLM(env, prompt, { temperature: 0.45, maxTokens: 900 });

  await memAppend(env, chatId, 'user', text);
  await memAppend(env, chatId, 'assistant', answer);

  await tgSendMessage(env, chatId, withDisclaimer(answer));
}

export default {
  async fetch(req: Request, envRaw: any, ctx: ExecutionContext): Promise<Response> {
    let env: WorkerEnv;
    try {
      env = parseEnv(envRaw);
    } catch (e: any) {
      return new Response(`Env error: ${e.message}`, { status: 500 });
    }

    const url = new URL(req.url);

    if (url.pathname === '/health') return new Response('ok');

    if (req.method === 'POST' && isValidWebhook(req, env)) {
      const update = await req.json().catch(() => null);
      const msg = getMessage(update);
      if (!msg) return Response.json({ ok: true });

      // commands
      const text = getText(msg).trim();
      if (text.startsWith('/')) {
        ctx.waitUntil(handleCommand(env, msg).catch(() => {}));
        return Response.json({ ok: true });
      }

      // photo
      if (Array.isArray(msg?.photo) && msg.photo.length) {
        ctx.waitUntil(handlePhoto(env, msg).catch(() => {}));
        return Response.json({ ok: true });
      }

      // fallback: text/caption
      ctx.waitUntil(handleText(env, msg).catch(() => {}));
      return Response.json({ ok: true });
    }

    return new Response('Not found', { status: 404 });
  },
};
