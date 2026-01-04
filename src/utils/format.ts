import type { NewsItem } from '../types';

export function formatHelp() {
  return [
    '🤖 <b>ربات تحلیل آموزشی چارت + خبر</b>',
    '',
    'دستورات:',
    '• /news BTC  → اخبار مرتبط',
    '• /signal BTCUSDT  → تحلیل و پلن آموزشی',
    '• /reset  → پاک کردن حافظه',
    '',
    'ارسال عکس چارت (Photo) هم پشتیبانی می‌شود.',
    '',
    '⚠️ خروجی‌ها آموزشی هستند و توصیه مالی نیستند.',
  ].join('\n');
}

export function formatNews(items: NewsItem[]) {
  if (!items.length) return 'خبر مرتبطی پیدا نشد.';
  const lines = items.slice(0, 8).map((n, i) => {
    const s = n.score ?? 0;
    return `${i + 1}) (${s}/10) ${escapeHtml(n.title)}\n${escapeHtml(n.url)}`;
  });
  return ['📰 <b>اخبار منتخب</b>', '', ...lines].join('\n\n');
}

export function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function extractMarketAndTimeframe(text: string): { market: string; timeframe?: string } {
  const t = (text || '').trim();
  // simple: /signal BTCUSDT 1h
  const parts = t.split(/\s+/).filter(Boolean);
  const market = parts[1] ? parts[1].toUpperCase() : 'BTC';
  const timeframe = parts[2] ? parts[2] : undefined;
  return { market, timeframe };
}
