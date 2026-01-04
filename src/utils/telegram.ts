import type { WorkerEnv } from '../env';

const TG_API = 'https://api.telegram.org';

export type TgUpdate = any;

export async function tgSendMessage(env: WorkerEnv, chatId: number | string, text: string, extra?: any) {
  const url = `${TG_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${t}`);
  }
  return res.json();
}

export async function tgSendPhoto(
  env: WorkerEnv,
  chatId: number | string,
  photo: string | Blob,
  caption?: string,
  extra?: any,
) {
  const url = `${TG_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const form = new FormData();
  form.set('chat_id', String(chatId));
  if (caption) form.set('caption', caption);
  form.set('parse_mode', 'HTML');
  if (typeof photo === 'string') {
    // can be file_id or URL
    form.set('photo', photo);
  } else {
    form.set('photo', photo, 'signal.png');
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      form.set(k, String(v));
    }
  }
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Telegram sendPhoto failed: ${res.status} ${t}`);
  }
  return res.json();
}

export async function tgGetFileUrl(env: WorkerEnv, fileId: string): Promise<string> {
  const url = `${TG_API}/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Telegram getFile failed: ${res.status} ${t}`);
  }
  const j: any = await res.json();
  const filePath = j?.result?.file_path;
  if (!filePath) throw new Error('Telegram getFile: missing file_path');
  return `${TG_API}/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
}

export async function fetchAsBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch blob failed: ${res.status}`);
  return await res.blob();
}

export function pickBestPhotoFileId(message: any): string | null {
  // Telegram sends array of photos (different sizes)
  const photos = message?.photo;
  if (!Array.isArray(photos) || photos.length === 0) return null;
  // pick largest
  const best = photos.reduce((a: any, b: any) => ((b.file_size ?? 0) > (a.file_size ?? 0) ? b : a), photos[0]);
  return best?.file_id ?? null;
}
