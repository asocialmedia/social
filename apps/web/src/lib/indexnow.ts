import { siteConfig } from "@asm/ui/meta/site";

// IndexNow: instantly notify Bing / Yandex / Seznam / DuckDuckGo
// about new or updated URLs. Google ignores it but Bing's index is
// the stale part of this domain's problem.
// Docs: https://www.indexnow.org/documentation

const INDEXNOW_KEY = process.env.INDEXNOW_KEY || "";
// Key location must be https://asocialmedia.cc/{KEY}.txt containing the key.
// The endpoint is https://api.indexnow.org/indexnow
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

export function isIndexNowEnabled(): boolean {
  return Boolean(INDEXNOW_KEY);
}

export function getIndexNowKey(): string {
  return INDEXNOW_KEY;
}

// Fire-and-forget: notify IndexNow about a single URL. Logs but never throws.
export async function submitToIndexNow(url: string): Promise<void> {
  if (!INDEXNOW_KEY) {
    return;
  }
  try {
    const payload = {
      host: new URL(siteConfig.url).host,
      key: INDEXNOW_KEY,
      keyLocation: `${siteConfig.url}/${INDEXNOW_KEY}.txt`,
      urlList: [url],
    };

    // 30s timeout, no retries here - caller may retry if needed.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10_000);
    await fetch(INDEXNOW_ENDPOINT, {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json; charset=utf-8" },
      method: "POST",
      signal: controller.signal,
    });
    clearTimeout(t);
  } catch (error) {
    // IndexNow is best-effort; don't break post creation.
    console.warn("[indexnow] submit failed for", url, error);
  }
}

export async function submitManyToIndexNow(urls: string[]): Promise<void> {
  if (!INDEXNOW_KEY || urls.length === 0) {
    return;
  }
  // IndexNow allows up to 10k URLs per request; we batch 100 for safety.
  const batchSize = 100;
  const batches: string[][] = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    batches.push(urls.slice(i, i + batchSize));
  }

  await Promise.all(
    batches.map(async (batch) => {
      try {
        const payload = {
          host: new URL(siteConfig.url).host,
          key: INDEXNOW_KEY,
          keyLocation: `${siteConfig.url}/${INDEXNOW_KEY}.txt`,
          urlList: batch,
        };
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 10_000);
        await fetch(INDEXNOW_ENDPOINT, {
          body: JSON.stringify(payload),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "POST",
          signal: controller.signal,
        });
        clearTimeout(t);
      } catch (error) {
        console.warn("[indexnow] batch submit failed", error);
      }
    })
  );
}
