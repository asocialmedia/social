// Guest search suggestions, ported from web's spotlight-search.ts
// (readSearchCandidates, rememberCandidates, suggestedResults). Results a
// searcher saw but did not open are kept for a week and offered back as
// "Suggested accounts" / "Suggested posts" while signed out.
// Free of React Native imports so it runs under bun:test.
import { z } from "zod";

import { insertionOrder } from "@/features/feed/lib/feed-types";

import type { SearchKind, SearchSource } from "./search-scope";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 32;

export const searchTargetSchema = z.object({
  avatarUrl: z.string().max(2048).nullable().optional(),
  displayName: z.string().min(1).max(280),
  explicitContent: z.boolean().optional(),
  href: z.string().max(2048),
  id: z.string().min(1).max(1024),
  source: z.enum(["asm", "bluesky"]),
  subtitle: z.string().max(160).optional(),
  type: z.enum(["user", "post", "community"]),
});
export type SearchTarget = z.infer<typeof searchTargetSchema>;

const candidateSchema = z.object({
  discoveredAt: z.number().finite(),
  query: z.string().trim().min(1).max(80),
  target: searchTargetSchema,
});
export type SearchCandidate = z.infer<typeof candidateSchema>;

function eligible(candidate: SearchCandidate, now: number) {
  return (
    candidate.target.type !== "community" &&
    !candidate.target.explicitContent &&
    now - candidate.discoveredAt <= WEEK_MS
  );
}

// Decodes a stored candidate list, dropping malformed, stale, explicit and
// community entries.
export function readSearchCandidates(
  value: unknown,
  now = Date.now()
): SearchCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((entry: unknown) => {
      const parsed = candidateSchema.safeParse(entry);
      return parsed.success && eligible(parsed.data, now) ? [parsed.data] : [];
    })
    .slice(0, MAX_CANDIDATES);
}

// Prepends the targets a query surfaced, newest first, keeping one entry per
// target id.
export function rememberCandidates(
  candidates: SearchCandidate[],
  targets: SearchTarget[],
  query: string,
  now = Date.now()
): SearchCandidate[] {
  const trimmed = query.trim().slice(0, 80);
  if (trimmed.length < 2) {
    return candidates;
  }
  const next = readSearchCandidates(
    targets.map((target) => ({ discoveredAt: now, query: trimmed, target })),
    now
  );
  const ids = new Set(next.map((entry) => entry.target.id));
  return [
    ...next,
    ...candidates.filter(
      (entry) =>
        !ids.has(entry.target.id) && now - entry.discoveredAt <= WEEK_MS
    ),
  ].slice(0, MAX_CANDIDATES);
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

// Candidates not yet opened, filtered to the active network and kind, newest
// first, then by how closely the name matched the query that found them.
export function suggestedCandidates(
  candidates: SearchCandidate[],
  openedIds: ReadonlySet<string>,
  source: SearchSource,
  kind: SearchKind,
  now = Date.now()
): SearchCandidate[] {
  // insertionOrder instead of toSorted: Hermes builds lack toSorted.
  return insertionOrder(
    candidates.filter(
      (entry) =>
        !openedIds.has(entry.target.id) &&
        eligible(entry, now) &&
        (source === "all" || entry.target.source === source) &&
        (kind === "all" || entry.target.type === kind)
    ),
    (left, right) =>
      right.discoveredAt - left.discoveredAt ||
      suggestionMatch(right) - suggestionMatch(left)
  ).filter(
    (entry, index, entries) =>
      entries.findIndex((other) => other.target.id === entry.target.id) ===
      index
  );
}
