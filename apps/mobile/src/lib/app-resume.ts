// App resume: restart where the reader left off, like Instagram/X.
// The last visited route (pathname + params) is saved on every navigation
// and restored once on cold start. TTL 7 days mirrors tab memory; an expired
// or unknown route falls back to home. Storage is SecureStore (small payload)
// via dynamic import so unit tests never parse react-native.
// Pure helpers are exported for tests.
export const RESUME_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESUME_KEY = "asm-app-resume-v1";

// Routes the resume is allowed to restore. Anything else (auth, modals that
// no longer exist) falls back to home so a stale deep link never strands the
// app on a dead screen.
const RESUMABLE_PREFIXES = [
  "/",
  "/discover",
  "/communities",
  "/gusts",
  "/hackernews",
  "/notifications",
  "/bookmarks",
  "/settings",
  "/posts/",
  "/users/",
  "/a/",
  "/hashtag/",
  "/legal/",
];

export interface ResumeState {
  params?: Record<string, string>;
  pathname: string;
  updatedAt: number;
}

// True when the pathname is one the app can restore.
export function isResumablePath(pathname: string): boolean {
  if (!pathname || typeof pathname !== "string") {
    return false;
  }
  // Auth routes never resume: a signed-out cold start must land on home.
  if (pathname.startsWith("/(auth)") || pathname.startsWith("/login")) {
    return false;
  }
  return RESUMABLE_PREFIXES.some((prefix) =>
    prefix === "/"
      ? pathname === "/"
      : pathname === prefix || pathname.startsWith(prefix)
  );
}

// True when the stored resume is fresh enough to restore.
export function isFreshResume(
  entry: ResumeState | null | undefined,
  now: number
): boolean {
  if (!entry) {
    return false;
  }
  if (!Number.isFinite(entry.updatedAt) || entry.updatedAt > now) {
    return false;
  }
  if (!isResumablePath(entry.pathname)) {
    return false;
  }
  return now - entry.updatedAt <= RESUME_TTL_MS;
}

// Parses stored JSON. Returns null on any mismatch.
export function parseResumeState(
  raw: string | null | undefined
): ResumeState | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ResumeState>;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    if (
      typeof parsed.pathname !== "string" ||
      !isResumablePath(parsed.pathname)
    ) {
      return null;
    }
    if (!Number.isFinite(parsed.updatedAt)) {
      return null;
    }
    const params: Record<string, string> = {};
    if (parsed.params && typeof parsed.params === "object") {
      for (const [k, v] of Object.entries(parsed.params)) {
        if (typeof v === "string") {
          params[k] = v;
        }
      }
    }
    return {
      params,
      pathname: parsed.pathname,
      updatedAt: parsed.updatedAt as number,
    };
  } catch {
    return null;
  }
}

// Serializes a resume entry.
export function serializeResumeState(
  pathname: string,
  params: Record<string, string> | undefined,
  now: number
): string {
  return JSON.stringify({ params: params ?? {}, pathname, updatedAt: now });
}

// In-memory fallback when SecureStore is unavailable (tests, web).
let memoryResume: string | null = null;

async function secureStore(): Promise<{
  getItemAsync: (k: string) => Promise<string | null>;
  setItemAsync: (k: string, v: string) => Promise<void>;
} | null> {
  try {
    const mod = await import("expo-secure-store");
    const store = mod as unknown as {
      getItemAsync?: (k: string) => Promise<string | null>;
      setItemAsync?: (k: string, v: string) => Promise<void>;
    };
    if (
      typeof store.getItemAsync === "function" &&
      typeof store.setItemAsync === "function"
    ) {
      return {
        getItemAsync: store.getItemAsync,
        setItemAsync: store.setItemAsync,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Saves the current route. Best-effort, never throws.
export async function saveResumeRoute(
  pathname: string,
  params?: Record<string, string>
): Promise<void> {
  if (!isResumablePath(pathname)) {
    return;
  }
  const body = serializeResumeState(pathname, params, Date.now());
  memoryResume = body;
  try {
    const store = await secureStore();
    if (store) {
      await store.setItemAsync(RESUME_KEY, body);
    }
  } catch {
    // Storage must never break navigation.
  }
}

// Loads the stored route when fresh, else null.
export async function loadResumeRoute(): Promise<ResumeState | null> {
  const now = Date.now();
  try {
    const store = await secureStore();
    const raw = store ? await store.getItemAsync(RESUME_KEY) : memoryResume;
    const parsed = parseResumeState(raw);
    return isFreshResume(parsed, now) ? parsed : null;
  } catch {
    const parsed = parseResumeState(memoryResume);
    return isFreshResume(parsed, now) ? parsed : null;
  }
}

// Test-only reset.
export function clearMemoryResume(): void {
  memoryResume = null;
}
