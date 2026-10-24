import type {
  SearchCommunityResult,
  SearchPostResult,
  SearchUserResult,
} from "@asm/db";
import type { ExternalAuthor, ExternalPost } from "@asm/protocols/contracts";

export type SearchSource = "all" | "asm" | "bluesky";
export type SearchKind = "all" | "user" | "post" | "community";

export interface SpotlightResponse {
  communities: SearchCommunityResult[];
  posts: SearchPostResult[];
  users: SearchUserResult[];
}

export interface BlueskySearchResponse {
  posts: ExternalPost[];
  profiles: ExternalAuthor[];
  unavailable: ("profiles" | "posts")[];
}

export interface RecentSearch {
  query: string;
  source: SearchSource;
  searchedAt: number;
  target?: SearchTarget;
}

export interface SearchTarget {
  id: string;
  type: "user" | "post" | "community";
  source: "asm" | "bluesky";
  displayName: string;
  href: string;
  avatarUrl?: string | null;
  subtitle?: string;
  explicitContent?: boolean;
}

export interface SearchCandidate {
  target: SearchTarget;
  query: string;
  discoveredAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTarget(value: unknown): SearchTarget | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 1024 ||
    (value.type !== "user" &&
      value.type !== "post" &&
      value.type !== "community") ||
    (value.source !== "asm" && value.source !== "bluesky") ||
    typeof value.displayName !== "string" ||
    !value.displayName ||
    typeof value.href !== "string" ||
    value.href.length > 2048 ||
    !/^\/(?:users\/|posts\/|a\/|gusts\?|network\/bluesky(?:\?|\/))/.test(
      value.href
    ) ||
    /[\\\r\n]/.test(value.href)
  ) {
    return;
  }
  return {
    avatarUrl:
      typeof value.avatarUrl === "string" &&
      value.avatarUrl.length <= 2048 &&
      /^(?:https?:\/\/|\/(?!\/))/.test(value.avatarUrl)
        ? value.avatarUrl
        : null,
    displayName:
      value.explicitContent === true
        ? "Sensitive post"
        : value.displayName.slice(0, 280),
    explicitContent: value.explicitContent === true,
    href: value.href,
    id: value.id,
    source: value.source,
    subtitle:
      typeof value.subtitle === "string"
        ? value.subtitle.slice(0, 160)
        : undefined,
    type: value.type,
  };
}

export function recentSearchKey(entry: RecentSearch): string {
  return entry.target
    ? entry.target.id
    : `query:${entry.source}:${entry.query.toLowerCase()}`;
}

export function readRecentSearches(value: string | null): RecentSearch[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .flatMap((entry: unknown): RecentSearch[] => {
        if (
          typeof entry !== "object" ||
          entry === null ||
          !("query" in entry) ||
          typeof entry.query !== "string" ||
          !entry.query.trim() ||
          entry.query.length > 80 ||
          !("source" in entry) ||
          (entry.source !== "all" &&
            entry.source !== "asm" &&
            entry.source !== "bluesky") ||
          !("searchedAt" in entry) ||
          typeof entry.searchedAt !== "number" ||
          !Number.isFinite(entry.searchedAt)
        ) {
          return [];
        }
        const target = "target" in entry ? readTarget(entry.target) : undefined;
        if ("target" in entry && !target) {
          return [];
        }
        return [
          {
            query: entry.query.trim(),
            searchedAt: entry.searchedAt,
            source: entry.source,
            ...(target ? { target } : {}),
          },
        ];
      })
      .slice(0, 10);
  } catch {
    return [];
  }
}

export function rememberSearch(
  history: RecentSearch[],
  query: string,
  source: SearchSource,
  now = Date.now()
): RecentSearch[] {
  const trimmed = query.trim().slice(0, 80);
  if (!trimmed) {
    return history;
  }
  return [
    { query: trimmed, searchedAt: now, source },
    ...history.filter(
      (entry) =>
        entry.target ||
        entry.query.toLowerCase() !== trimmed.toLowerCase() ||
        entry.source !== source
    ),
  ].slice(0, 10);
}

export function rememberResult(
  history: RecentSearch[],
  target: SearchTarget,
  query: string,
  now = Date.now()
): RecentSearch[] {
  const safeTarget = readTarget(target);
  if (!safeTarget) {
    return history;
  }
  const trimmed = (query.trim() || target.subtitle || target.displayName).slice(
    0,
    80
  );
  return [
    {
      query: trimmed,
      searchedAt: now,
      source: target.source,
      target: safeTarget,
    },
    ...history.filter((entry) =>
      entry.target
        ? entry.target.id !== target.id
        : entry.query.toLowerCase() !== trimmed.toLowerCase()
    ),
  ].slice(0, 10);
}

export function readSearchCandidates(
  value: string | null,
  now = Date.now()
): SearchCandidate[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .flatMap((entry: unknown): SearchCandidate[] => {
        if (
          !isRecord(entry) ||
          typeof entry.query !== "string" ||
          !entry.query.trim() ||
          entry.query.length > 80 ||
          typeof entry.discoveredAt !== "number" ||
          !Number.isFinite(entry.discoveredAt) ||
          now - entry.discoveredAt > 7 * 24 * 60 * 60 * 1000
        ) {
          return [];
        }
        const target = readTarget(entry.target);
        return target && target.type !== "community" && !target.explicitContent
          ? [{ discoveredAt: entry.discoveredAt, query: entry.query, target }]
          : [];
      })
      .slice(0, 32);
  } catch {
    return [];
  }
}

export function rememberCandidates(
  candidates: SearchCandidate[],
  targets: SearchTarget[],
  query: string,
  now = Date.now()
): SearchCandidate[] {
  if (query.trim().length < 2) {
    return candidates;
  }
  const next = readSearchCandidates(
    JSON.stringify(
      targets
        .filter(
          (target) => target.type !== "community" && !target.explicitContent
        )
        .map((target) => ({
          discoveredAt: now,
          query: query.trim().slice(0, 80),
          target,
        }))
    ),
    now
  );
  const ids = new Set(next.map((entry) => entry.target.id));
  return [
    ...next,
    ...candidates.filter(
      (entry) =>
        !ids.has(entry.target.id) &&
        now - entry.discoveredAt <= 7 * 24 * 60 * 60 * 1000
    ),
  ].slice(0, 32);
}

export function suggestedResults(
  candidates: SearchCandidate[],
  history: RecentSearch[],
  source: SearchSource,
  kind: SearchKind,
  now = Date.now()
): SearchCandidate[] {
  const opened = new Set(
    history.flatMap((entry) => (entry.target ? [entry.target.id] : []))
  );
  return candidates
    .filter(
      (entry) =>
        !opened.has(entry.target.id) &&
        !entry.target.explicitContent &&
        now - entry.discoveredAt <= 7 * 24 * 60 * 60 * 1000 &&
        (source === "all" || entry.target.source === source) &&
        (kind === "all" || entry.target.type === kind)
    )
    .toSorted(
      (left, right) =>
        right.discoveredAt - left.discoveredAt ||
        suggestionMatch(right) - suggestionMatch(left)
    )
    .filter(
      (entry, index, entries) =>
        entries.findIndex((other) => other.target.id === entry.target.id) ===
        index
    );
}

function suggestionMatch(entry: SearchCandidate): number {
  const query = entry.query.toLowerCase();
  const name = entry.target.displayName.toLowerCase();
  const handle = entry.target.subtitle?.toLowerCase().replace(/^@/, "");
  if (name === query || handle === query) {
    return 3;
  }
  if (name.startsWith(query) || handle?.startsWith(query)) {
    return 2;
  }
  return name.includes(query) ? 1 : 0;
}

export async function fetchSearch<T>(
  url: string,
  signal: AbortSignal
): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new SearchReadError(
      response.status,
      Number.isFinite(retryAfter) ? Math.max(1, retryAfter) : 1
    );
  }
  return response.json();
}

export class SearchReadError extends Error {
  readonly status: number;
  readonly retryAfter: number;
  constructor(status: number, retryAfter: number) {
    super(
      status === 429
        ? `Search limit reached. Try again in ${retryAfter}s.`
        : "Search is temporarily busy. Try again shortly."
    );
    this.name = "SearchReadError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
