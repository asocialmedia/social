import { useSyncExternalStore } from "react";

// Cross-surface memory for dismissed explicit-content gates, keyed by post
// id. The feed card, post page, and fullscreen media page all render their
// own gate instance; without shared state the user would confirm "Continue"
// once per surface.
//
// Reveals EXPIRE: this is a warning gate, not a preference. After
// EXPLICIT_REVEAL_TTL_MS the blur re-arms and the user must confirm again.
// Session-scoped storage also means a fresh browser session re-gates.

const STORAGE_KEY = "asm-explicit-revealed";

// How long a dismissal stays honored before the gate re-arms.
export const EXPLICIT_REVEAL_TTL_MS = 30 * 60 * 1000;

// postId -> reveal timestamp (ms epoch).
let revealedIds: Record<string, number> | null = null;
const listeners = new Set<() => void>();

function load(): Record<string, number> {
  if (revealedIds) {
    return revealedIds;
  }
  let loaded: Record<string, number>;
  if (typeof window === "undefined") {
    loaded = {};
  } else {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      loaded = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      loaded = {};
    }
  }
  revealedIds = loaded;
  return loaded;
}

function isFresh(revealedAt: number | undefined): boolean {
  return (
    revealedAt !== undefined && Date.now() - revealedAt < EXPLICIT_REVEAL_TTL_MS
  );
}

function persist(): void {
  if (!revealedIds) {
    return;
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(revealedIds));
  } catch {
    // Storage unavailable (private mode/quota): in-memory only.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isExplicitRevealed(postId: string | null | undefined): boolean {
  if (!postId) {
    return false;
  }
  return isFresh(load()[postId]);
}

export function revealExplicit(postId: string): void {
  const ids = load();
  if (isFresh(ids[postId])) {
    return;
  }
  ids[postId] = Date.now();
  persist();
  for (const listener of listeners) {
    listener();
  }
}

export function useExplicitRevealed(
  postId: string | null | undefined
): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (postId ? isFresh(load()[postId]) : false),
    () => false
  );
}
