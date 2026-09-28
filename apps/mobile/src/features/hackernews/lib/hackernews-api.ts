// HackerNews client, mirroring the web feed's route contract:
//   GET    /api/hackernews?page&limit&search&sort&type
//   GET    /api/hackernews/bookmarked
//   POST   /api/hackernews/bookmark-states   (batched, one round trip)
//   POST   /api/hackernews/:id/bookmark      DELETE to unbookmark
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { getWithTimeout } from "@/lib/http-get";

export const HN_SORT_OPTIONS = [
  { label: "Score", value: "score" },
  { label: "Time", value: "time" },
  { label: "Comments", value: "comments" },
] as const;

export type HnSort = (typeof HN_SORT_OPTIONS)[number]["value"];

export const HN_FILTER_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Stories", value: "story" },
  { label: "Jobs", value: "job" },
  { label: "Show HN", value: "show" },
  { label: "Ask HN", value: "ask" },
] as const;

export type HnFilter = (typeof HN_FILTER_OPTIONS)[number]["value"];

export interface HnStory {
  by: string;
  comments: number;
  domain: string | null;
  id: number;
  score: number;
  time: number;
  title: string;
  url: string | null;
}

export class HnApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HnApiError";
    this.status = status;
  }
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function numberOf(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The hostname shown on the story row. Web calls `new URL(url).hostname`, which
 * throws on a relative or malformed url, so a bad row is dropped here rather
 * than taking the whole page down with it.
 */
export function domainOf(url: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function parseHnStory(value: unknown): HnStory | null {
  const story = objectOf(value);
  const id = story?.id;
  if (!story || typeof id !== "number" || !Number.isFinite(id)) {
    return null;
  }
  const title = textOf(story.title);
  if (!title) {
    return null;
  }
  const url = textOf(story.url);
  return {
    by: textOf(story.by) ?? "unknown",
    // The aggregator names the comment count `descendants`.
    comments: numberOf(story.descendants ?? story.comments),
    domain: domainOf(url),
    id,
    score: numberOf(story.score),
    time: numberOf(story.time),
    title,
    url,
  };
}

export function parseHnStories(payload: unknown): HnStory[] {
  const body = objectOf(payload);
  const rows = Array.isArray(payload)
    ? payload
    : (body?.stories as unknown[] | undefined);
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const story = parseHnStory(row);
    return story ? [story] : [];
  });
}

export function buildHnPath({
  page = 1,
  search = "",
  sort = "score",
  type = "all",
}: {
  page?: number;
  search?: string;
  sort?: HnSort;
  type?: HnFilter;
} = {}): string {
  const params = new URLSearchParams({
    limit: "20",
    page: String(Math.max(1, page)),
    sort,
    type,
  });
  const trimmed = search.trim();
  if (trimmed) {
    params.set("search", trimmed);
  }
  return `/api/hackernews?${params.toString()}`;
}

function get(path: string, options: ApiCallOptions): Promise<Response> {
  return getWithTimeout(
    `${options.apiBase}${path}`,
    { headers: options.cookie ? { cookie: options.cookie } : {} },
    { baseFetch: options.baseFetch ?? fetch, timeoutMs: options.timeoutMs }
  );
}

export interface HnPage {
  rateLimited: boolean;
  stories: HnStory[];
}

export async function fetchHnPage(
  params: Parameters<typeof buildHnPath>[0],
  options: ApiCallOptions
): Promise<HnPage> {
  const response = await get(buildHnPath(params), options);
  if (response.status === 429) {
    // Web renders its own art for this rather than an error, and the feed is
    // still usable once the window passes, so it is a state and not a throw.
    return { rateLimited: true, stories: [] };
  }
  if (!response.ok) {
    throw new HnApiError(
      `HackerNews request failed (${response.status})`,
      response.status
    );
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  return { rateLimited: false, stories: parseHnStories(payload) };
}

export async function fetchBookmarkedHn(
  options: ApiCallOptions
): Promise<HnStory[]> {
  const response = await get("/api/hackernews/bookmarked", options);
  if (!response.ok) {
    return [];
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  return parseHnStories(payload);
}

/** One round trip for every visible row, rather than one per card. */
// One round trip for every visible row, rather than one per card. Declared async
// with an all-guard so the happy path really does await, and a failure returns
// an empty map rather than rejecting: bookmark state is an enhancement on the
// row, so a failure leaves every row unbookmarked instead of blocking the feed.
export async function fetchHnBookmarkStates(
  ids: number[],
  options: ApiCallOptions
): Promise<Record<number, boolean>> {
  if (ids.length === 0) {
    await Promise.resolve();
    return {};
  }
  try {
    const response = await (options.baseFetch ?? fetch)(
      `${options.apiBase}/api/hackernews/bookmark-states`,
      {
        body: JSON.stringify({ storyIds: ids.slice(0, 200) }),
        headers: {
          "content-type": "application/json",
          ...(options.cookie ? { cookie: options.cookie } : null),
        },
        method: "POST",
      }
    );
    if (!response.ok) {
      return {};
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    const body = objectOf(payload);
    const raw = objectOf(body?.bookmarked);
    if (!raw) {
      return {};
    }
    const result: Record<number, boolean> = {};
    for (const [key, value] of Object.entries(raw)) {
      const id = Number(key);
      if (Number.isFinite(id) && typeof value === "boolean") {
        result[id] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export async function setHnBookmark(
  storyId: number,
  bookmarked: boolean,
  options: ApiCallOptions
): Promise<boolean> {
  try {
    const response = await (options.baseFetch ?? fetch)(
      `${options.apiBase}/api/hackernews/${storyId}/bookmark`,
      {
        headers: options.cookie ? { cookie: options.cookie } : {},
        method: bookmarked ? "POST" : "DELETE",
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}
