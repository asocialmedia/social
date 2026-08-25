import { useSyncExternalStore } from "react";

// Cross-surface memory for dismissed explicit-content gates, keyed by post
// id. The feed card, post page, and fullscreen media page all render their
// own gate instance; without shared state the user would confirm "Continue"
// once per surface. Session-scoped on purpose: a fresh browser session
// re-gates explicit media, which is the expected safety behaviour.

const STORAGE_KEY = "asm-explicit-revealed";

let revealedIds: Set<string> | null = null;
const listeners = new Set<() => void>();

function load(): Set<string> {
  if (revealedIds) {
    return revealedIds;
  }
  let loaded: Set<string>;
  if (typeof window === "undefined") {
    loaded = new Set();
  } else {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      loaded = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      loaded = new Set();
    }
  }
  revealedIds = loaded;
  return loaded;
}

function persist(): void {
  if (!revealedIds) {
    return;
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...revealedIds]));
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
  return load().has(postId);
}

export function revealExplicit(postId: string): void {
  const ids = load();
  if (ids.has(postId)) {
    return;
  }
  ids.add(postId);
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
    () => (postId ? load().has(postId) : false),
    () => false
  );
}
