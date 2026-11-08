// Suggestion query cache, the native twin of web's `staleTime: 30_000` on
// the comment/post suggestion queries: reopening a trigger or retyping a
// prefix reuses rows instead of refetching. Raw rows are cached before
// exclusion filtering because the exclusion lists (already-picked pills)
// change per keystroke while the query does not. Pure + time-injectable for
// tests.
export interface SuggestionUser {
  avatarUrl: string | null;
  displayName?: string | null;
  id: string;
  username: string;
}

export interface CachedSuggestions {
  at: number;
  tags: string[];
  users: SuggestionUser[];
}

export const SUGGESTION_TTL_MS = 30_000;

const suggestionCache = new Map<string, CachedSuggestions>();

export function readCachedSuggestions(
  key: string,
  now: number = Date.now()
): CachedSuggestions | null {
  const cached = suggestionCache.get(key);
  if (!cached || now - cached.at > SUGGESTION_TTL_MS) {
    if (cached) {
      suggestionCache.delete(key);
    }
    return null;
  }
  return cached;
}

export function writeCachedSuggestions(
  key: string,
  result: Omit<CachedSuggestions, "at">,
  now: number = Date.now()
): void {
  suggestionCache.set(key, { ...result, at: now });
}

export function clearCachedSuggestions(): void {
  suggestionCache.clear();
}
