export const KLIPY_API_BASE = "https://api.klipy.com/api/v1";

// Formats a KLIPY media object (e.g. file.xs.gif) into a normalized preview.
export interface KlipyGif {
  id: number | string;
  preview: string;
  slug: string;
  title: string;
  url: string;
}

interface KlipyMediaFormat {
  url?: string;
  width?: number;
  height?: number;
  size?: number;
}

interface KlipyGifItem {
  file?: Record<
    string,
    Record<string, KlipyMediaFormat | undefined> | undefined
  >;
  id?: number | string;
  slug?: string;
  title?: string;
}

interface KlipyResponse {
  data?: {
    data?: KlipyGifItem[];
  };
  result?: boolean;
}

function pickFormat(
  file: KlipyGifItem["file"],
  size: string,
  format: string
): KlipyMediaFormat | undefined {
  return file?.[size]?.[format];
}

// The picker grid uses the smallest GIF preview for speed; the full-size GIF
// is what gets attached to the eddie.
export function normalizeKlipyGifs(payload: KlipyResponse): KlipyGif[] {
  const items = payload?.data?.data ?? [];
  return items
    .map((item): KlipyGif | null => {
      const { file } = item;
      const preview = pickFormat(file, "sm", "gif");
      const full =
        pickFormat(file, "hd", "gif") ?? pickFormat(file, "md", "gif");
      const url = full?.url ?? preview?.url;
      if (!url) {
        return null;
      }
      return {
        id: item.id ?? item.slug ?? url,
        preview: preview?.url ?? url,
        slug: item.slug ?? "",
        title: item.title ?? "",
        url,
      };
    })
    .filter((g): g is KlipyGif => g !== null);
}

async function fetchKlipy(endpoint: string, search: URLSearchParams) {
  // Read the key at request time rather than through the @t3-oss/env binding
  // (which is captured at module import, before instrumentation loads the root
  // .env in dev). This keeps a server-only key out of the client bundle too.
  const appKey = process.env.KLIPY_APP_KEY;
  if (!appKey) {
    return Response.json({ error: "KLIPY is not configured" }, { status: 503 });
  }

  const url = new URL(`${KLIPY_API_BASE}/${appKey}/${endpoint}`);
  url.search = search.toString();

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    return Response.json(
      { error: `KLIPY request failed (${response.status})` },
      { status: response.status }
    );
  }

  const payload = (await response.json()) as KlipyResponse;
  return Response.json({
    gifs: normalizeKlipyGifs(payload),
    hasNext: Boolean(payload.data?.data?.length),
  });
}

export function searchKlipyGifs(q: string, page = 1) {
  const search = new URLSearchParams({
    content_filter: "medium",
    format_filter: "gif",
    page: String(page),
    per_page: "24",
    q,
  });
  return fetchKlipy("gifs/search", search);
}

export function trendingKlipyGifs(page = 1) {
  const search = new URLSearchParams({
    content_filter: "medium",
    format_filter: "gif",
    page: String(page),
    per_page: "24",
  });
  return fetchKlipy("gifs/trending", search);
}
