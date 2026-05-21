// IndexNow integration - ping search engines khi publish bài mới
// Bing, Yandex, Seznam, Naver, Yep tham gia IndexNow protocol
// Google không tham gia trực tiếp nhưng vẫn crawl nhanh nhờ sitemap
// Docs: https://www.indexnow.org/
import type { Bindings } from '../types';

const INDEXNOW_ENDPOINTS = [
  'https://api.indexnow.org/IndexNow',
];

export async function pingIndexNow(
  env: Bindings,
  urls: string[]
): Promise<{ ok: boolean; error?: string }> {
  const key = env.INDEXNOW_KEY;
  const siteUrl = env.SITE_URL;

  if (!key || !siteUrl) {
    console.log('[IndexNow] Skipped - missing INDEXNOW_KEY or SITE_URL');
    return { ok: false, error: 'INDEXNOW_KEY hoặc SITE_URL chưa được cấu hình' };
  }

  if (urls.length === 0) {
    return { ok: true };
  }

  const host = new URL(siteUrl).hostname;
  const payload = {
    host,
    key,
    keyLocation: `${siteUrl}/${key}.txt`,
    urlList: urls,
  };

  const results = await Promise.allSettled(
    INDEXNOW_ENDPOINTS.map((endpoint) =>
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    )
  );

  const anySuccess = results.some(
    (r) => r.status === 'fulfilled' && r.value.ok
  );

  if (!anySuccess) {
    const errors = results
      .map((r) =>
        r.status === 'rejected'
          ? r.reason
          : `${r.value.status} ${r.value.statusText}`
      )
      .join(', ');
    console.error('[IndexNow] All endpoints failed:', errors);
    return { ok: false, error: 'Tất cả endpoint IndexNow đều fail: ' + errors };
  }

  console.log('[IndexNow] Pinged', urls.length, 'URLs');
  return { ok: true };
}

// Gọi background không block response
export function pingIndexNowAsync(
  env: Bindings,
  executionCtx: ExecutionContext,
  urls: string[]
) {
  executionCtx.waitUntil(
    pingIndexNow(env, urls).catch((err) => {
      console.error('[IndexNow] Background ping failed:', err);
    })
  );
}
