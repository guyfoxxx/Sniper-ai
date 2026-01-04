import type { MemoryMessage } from './types';
import { numEnv, type WorkerEnv } from './env';
import { callTextLLM } from './providers/llm';

export type MemoryState = {
  summary: string; // compact summary of older context
  messages: MemoryMessage[]; // recent turns
  userPrompt?: string; // custom prompt user adds later
  lastVision?: string; // last chart analysis
  updatedAt: number;
};

const DEFAULT_STATE: MemoryState = {
  summary: '',
  messages: [],
  updatedAt: Date.now(),
};

export class MemoryDO implements DurableObject {
  private state: DurableObjectState;
  private env: WorkerEnv;

  constructor(state: DurableObjectState, env: WorkerEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/+/, '');
    if (req.method === 'POST' && path === 'append') return this.append(req);
    if (req.method === 'POST' && path === 'setPrompt') return this.setPrompt(req);
    if (req.method === 'POST' && path === 'setVision') return this.setVision(req);
    if (req.method === 'GET' && path === 'get') return this.get();
    if (req.method === 'POST' && path === 'reset') return this.reset();
    return new Response('Not found', { status: 404 });
  }

  private async load(): Promise<MemoryState> {
    const data = (await this.state.storage.get<MemoryState>('mem')) ?? DEFAULT_STATE;
    // defensive normalization
    data.messages ??= [];
    data.summary ??= '';
    data.updatedAt ??= Date.now();
    return data;
  }

  private async save(mem: MemoryState) {
    mem.updatedAt = Date.now();
    await this.state.storage.put('mem', mem);
  }

  private async get(): Promise<Response> {
    const mem = await this.load();
    return Response.json(mem);
  }

  private async reset(): Promise<Response> {
    await this.state.storage.deleteAll();
    return Response.json({ ok: true });
  }

  private async setPrompt(req: Request): Promise<Response> {
    const mem = await this.load();
    const { prompt } = (await req.json()) as { prompt?: string };
    mem.userPrompt = (prompt ?? '').slice(0, 4000);
    await this.save(mem);
    return Response.json({ ok: true });
  }

  private async setVision(req: Request): Promise<Response> {
    const mem = await this.load();
    const { vision } = (await req.json()) as { vision?: string };
    mem.lastVision = (vision ?? '').slice(0, 8000);
    await this.save(mem);
    return Response.json({ ok: true });
  }

  private async append(req: Request): Promise<Response> {
    const mem = await this.load();
    const { role, content } = (await req.json()) as { role: MemoryMessage['role']; content: string };
    mem.messages.push({ role, content: String(content).slice(0, 8000), ts: Date.now() });

    const maxTurns = numEnv(this.env.MEMORY_MAX_TURNS, 20);
    const summaryTrigger = numEnv(this.env.MEMORY_SUMMARY_TRIGGER, 28);

    // If too many, summarize older part
    if (mem.messages.length > summaryTrigger) {
      const keep = mem.messages.slice(-maxTurns);
      const toSummarize = mem.messages.slice(0, mem.messages.length - keep.length);

      const transcript = toSummarize
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n')
        .slice(0, 12000);

      const summaryPrompt = [
        'تو یک سیستم خلاصه‌ساز حافظه برای یک ربات تلگرام تحلیل بازار هستی.',
        'هدف: خلاصه‌ای کوتاه، دقیق و قابل استفاده در پاسخ‌های بعدی تولید کن.',
        'خلاصه باید شامل: دارایی‌های مورد بحث، سبک تحلیل کاربر، ریسک‌پذیری، تایم‌فریم‌ها، سطوح مهم و تصمیم‌های قبلی باشد.',
        'فقط خلاصه را بده و از حاشیه رفتن پرهیز کن.',
        '',
        'خلاصه قبلی (اگر هست):',
        mem.summary || '(خالی)',
        '',
        'متن برای خلاصه‌سازی:',
        transcript,
      ].join('\n');

      const summary = await callTextLLM(this.env, summaryPrompt, { temperature: 0.2, maxTokens: 450 });
      mem.summary = (summary || mem.summary).slice(0, 6000);
      mem.messages = keep;
    }

    await this.save(mem);
    return Response.json({ ok: true, count: mem.messages.length });
  }
}
