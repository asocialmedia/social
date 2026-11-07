// Pending Hacker News share, the native twin of web's sessionStorage-backed
// useHnShareStore (packages/ui/store/hn-share-store.ts): tapping "Reshare as
// fleet" on a story must survive the trip through the login screen (guests)
// and a cold start, so the composer can seed itself afterwards. Web keeps
// that pending share in sessionStorage and rehydrates it on mount; native
// keeps the same tiny JSON in SecureStore and consumes it on composer open.
// Only encode/decode is pure; the storage calls take an injectable store so
// bun tests never touch expo-secure-store.
import type { HnShareDraft } from "../state/composer-store";

const STORAGE_KEY = "asm-pending-hn-share";
const STORAGE_VERSION = 1;

export interface HnShareStorage {
  getItem: (key: string) => Promise<string | null>;
  removeItem: (key: string) => Promise<void>;
  setItem: (key: string, value: string) => Promise<void>;
}

interface StoredShare {
  story: HnShareDraft;
  version: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Encodes a pending share for storage. Returns null when the story has no
// usable identity (nothing to restore later).
export function encodePendingHnShare(story: HnShareDraft): string | null {
  if (!story || typeof story.storyId !== "number" || !story.title) {
    return null;
  }
  const stored: StoredShare = {
    story: {
      by: story.by ?? null,
      descendants: story.descendants ?? null,
      score: story.score ?? null,
      storyId: story.storyId,
      time: story.time ?? null,
      title: story.title,
      url: story.url ?? null,
    },
    version: STORAGE_VERSION,
  };
  return JSON.stringify(stored);
}

// Decodes a stored share. Older versions and corrupt payloads (including a
// story with no identity) decode to null so a bad write can never seed the
// composer with garbage.
export function decodePendingHnShare(raw: string | null): HnShareDraft | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) {
      return null;
    }
    const { story } = parsed;
    if (!isRecord(story)) {
      return null;
    }
    if (typeof story.storyId !== "number" || typeof story.title !== "string") {
      return null;
    }
    return {
      by: typeof story.by === "string" ? story.by : null,
      descendants:
        typeof story.descendants === "number" ? story.descendants : null,
      score: typeof story.score === "number" ? story.score : null,
      storyId: story.storyId,
      time: typeof story.time === "number" ? story.time : null,
      title: story.title,
      url: typeof story.url === "string" ? story.url : null,
    };
  } catch {
    return null;
  }
}

export async function savePendingHnShare(
  storage: HnShareStorage,
  story: HnShareDraft
): Promise<void> {
  const raw = encodePendingHnShare(story);
  if (!raw) {
    return;
  }
  try {
    await storage.setItem(STORAGE_KEY, raw);
  } catch {
    // A share that cannot persist still opens the composer in memory.
  }
}

export async function loadPendingHnShare(
  storage: HnShareStorage
): Promise<HnShareDraft | null> {
  try {
    return decodePendingHnShare(await storage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export async function clearPendingHnShare(
  storage: HnShareStorage
): Promise<void> {
  try {
    await storage.removeItem(STORAGE_KEY);
  } catch {
    // Clearing is best-effort; a stale share is dropped on decode instead.
  }
}
