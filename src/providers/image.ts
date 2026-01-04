import type { WorkerEnv } from '../env';

type ImgGen = {
  prompt: string;
  size?: '512x512' | '1024x1024' | '1024x1792' | '1792x1024';
};

function cfImageModel(env: WorkerEnv) {
  return env.CF_IMAGE_MODEL || '@cf/stabilityai/stable-diffusion-xl-base-1.0';
}

// returns PNG blob
export async function generateSignalImage(env: WorkerEnv, req: ImgGen): Promise<Blob | null> {
  const prompt = req.prompt;
  const size = req.size || '1024x1024';

  // 1) DALL·E (OpenAI)
  if (env.OPENAI_API_KEY) {
    try {
      const model = env.OPENAI_IMAGE_MODEL || 'dall-e-3';
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          size,
          n: 1,
        }),
      });
      if (res.ok) {
        const j: any = await res.json();
        const b64 = j?.data?.[0]?.b64_json;
        const url = j?.data?.[0]?.url;
        if (b64) {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          return new Blob([bytes], { type: 'image/png' });
        }
        if (url) {
          const imgRes = await fetch(url);
          if (imgRes.ok) return await imgRes.blob();
        }
      }
    } catch (_) {
      // continue
    }
  }

  // 2) NanoBanana (custom endpoint - optional)
  if (env.NANOBANANA_API_URL && env.NANOBANANA_API_KEY) {
    try {
      const res = await fetch(env.NANOBANANA_API_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.NANOBANANA_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ prompt, size, n: 1 }),
      });
      if (res.ok) {
        // Expect either raw image or JSON with base64
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const j: any = await res.json();
          const b64 = j?.b64 ?? j?.data?.[0]?.b64;
          if (b64) {
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            return new Blob([bytes], { type: 'image/png' });
          }
        } else {
          return await res.blob();
        }
      }
    } catch (_) {
      // continue
    }
  }

  // 3) Cloudflare SDXL
  try {
    const model = cfImageModel(env);
    const r: any = await env.AI.run(model as any, {
      prompt,
      width: 1024,
      height: 1024,
      num_steps: 28,
    });
    // Workers AI often returns base64 for image
    const b64 = r?.image ?? r?.result ?? r?.output ?? r?.b64;
    if (typeof b64 === 'string' && b64.length > 100) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return new Blob([bytes], { type: 'image/png' });
    }
  } catch (_) {
    // ignore
  }

  return null;
}
