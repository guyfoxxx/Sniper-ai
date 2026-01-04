# ربات تلگرام تحلیل چارت و خبر روی Cloudflare Workers (با حافظه)

این پروژه یک **Telegram Bot** روی **Cloudflare Workers** است که:
- عکس چارت را از تلگرام می‌گیرد و **تحلیل آموزشی** تولید می‌کند.
- برای تولید تحلیل/سیگنال از مدل‌ها به ترتیب زیر استفاده می‌کند:
  1) **Cloudflare Workers AI**
  2) **OpenAI**
  3) **Gemini**
- برای **تحلیل تصویر (Vision)** به ترتیب:
  1) OpenAI Vision
  2) Cloudflare Vision (LLaVA)
  3) HuggingFace endpoint
- برای **ساخت تصویر (کارت سیگنال/خلاصه)** به ترتیب:
  1) DALL·E (OpenAI)
  2) NanoBanana (اختیاری؛ Endpoint سفارشی شما)
  3) Cloudflare Stable Diffusion
- اخبار مرتبط (کریپتو/فارکس) را از **NewsAPI** و **Google CSE** می‌گیرد و سپس مدل **Gemma** به هر خبر امتیاز ۱ تا ۱۰ می‌دهد.
- دارای **حافظه مکالمه** (Durable Object) برای هر چت است و مدل‌ها بر اساس آن پاسخ می‌دهند.

> ⚠️ **هشدار مهم**: خروجی‌ها صرفاً آموزشی هستند و توصیه مالی/سرمایه‌گذاری محسوب نمی‌شوند.

---

## 1) ساخت ربات تلگرام و گرفتن توکن
از BotFather توکن بگیرید و مقدار `TELEGRAM_BOT_TOKEN` را ذخیره کنید.

---

## 2) آماده‌سازی Cloudflare
### 2.1) ساخت Worker + فعال کردن AI
- Cloudflare Dashboard → Workers & Pages → Create Worker
- Workers AI را برای اکانت فعال کنید.

### 2.2) ساخت Durable Object
این پروژه از Durable Object استفاده می‌کند و با `wrangler deploy` خودکار ساخته می‌شود.

### 2.3) (اختیاری) KV برای کش اخبار
- Cloudflare Dashboard → KV → Create namespace
- مقادیر `id` و `preview_id` را داخل `wrangler.toml` جایگزین کنید
- اگر KV ندارید هم پروژه کار می‌کند (کش با Cache API انجام می‌شود).

---

## 3) تنظیم Secrets و Vars
### روش ساده (Dashboard)
Worker → Settings → Variables → Add

**Secrets (مهم):**
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (یک رشته تصادفی؛ مثل 40 کاراکتر)
- `NEWSAPI_KEY` (اگر دارید)
- `GOOGLE_CSE_API_KEY` و `GOOGLE_CSE_CX` (اگر دارید)
- (اختیاری) `OPENAI_API_KEY`
- (اختیاری) `GEMINI_API_KEY`
- (اختیاری) `NANOBANANA_API_URL` و `NANOBANANA_API_KEY`
- (اختیاری) `HF_API_URL` و `HF_API_KEY`

**Vars (اختیاری):**
- `CF_TEXT_MODEL` (پیش‌فرض داخل کد)
- `CF_VISION_MODEL`
- `CF_IMAGE_MODEL`
- `CF_GEMMA_MODEL`
- `OPENAI_TEXT_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_IMAGE_MODEL`
- `GEMINI_TEXT_MODEL`
- `MEMORY_MAX_TURNS` (پیش‌فرض 20)
- `MEMORY_SUMMARY_TRIGGER` (پیش‌فرض 28)

---

## 4) دیپلوی از GitHub
- این ریپو را در GitHub بسازید و فایل‌ها را Push کنید.
- Cloudflare Dashboard → Workers & Pages → Create → Import from GitHub
- Build command: `npm run deploy` لازم نیست؛ Cloudflare خودش deploy می‌کند. (یا از Wrangler CI استفاده کنید)
- بهتر: GitHub Actions برای Wrangler (اختیاری).

---

## 5) ست کردن Webhook تلگرام
بعد از دیپلوی، URL Worker را دارید مثل:
`https://<worker>.<subdomain>.workers.dev`

Webhook را اینطور ست کنید:

```
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<YOUR_WORKER_URL>/telegram/<TELEGRAM_WEBHOOK_SECRET>
```

---

## 6) استفاده در تلگرام
- `/start` راهنما
- `/reset` پاک کردن حافظه
- `/news BTC` اخبار مرتبط
- `/signal BTCUSDT` یا `/signal EURUSD`
- ارسال عکس چارت (Photo) → تحلیل + کارت سیگنال

---

## ساختار کلی (مشابه دیاگرام شما)
- Telegram → Worker (Router)
- Worker → Memory(DO)
- Worker → NewsAPI / Google CSE
- Worker → AI providers (CF AI → OpenAI → Gemini)
- Worker → Image generation (DALL·E → NanoBanana → CF SDXL)
- Worker → Vision (OpenAI → CF LLaVA → HF)

---

## نکته
برای اینکه «پرامپت اصلی سیگنال» را بعداً اضافه کنید:
- فایل `src/prompt.ts` بخش `buildSignalPrompt()` را ویرایش کنید.
- همچنین می‌توانید دستور `/setprompt` را اضافه کنید تا داخل حافظه ذخیره شود.
