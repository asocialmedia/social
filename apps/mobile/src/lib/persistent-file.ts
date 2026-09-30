// File-backed snapshot IO for persistent caches.
// Uses the modern expo-file-system File/Paths API with a legacy fallback so
// the same code runs on SDK 57 dev builds and older runners. All functions
// are best-effort and never throw: a missing file or a failed write just
// means "no cache", never a broken screen.
import { parseSnapshot, serializeSnapshot, snapshotFileName } from "./persistent-cache";
import type { PersistSnapshot } from "./persistent-cache";

// Reads a cache snapshot file. Returns empty when the file is missing,
// unreadable or corrupt.
export async function readSnapshot<T>(cacheName: string): Promise<PersistSnapshot<T>> {
  try {
    const mod = await import("expo-file-system");
    const fileMod = mod as unknown as {
      File?: new (dir: unknown, name: string) => { textSync?: () => string; text?: () => Promise<string>; exists?: boolean };
      Paths?: { cache?: unknown };
    };
    // Modern API: File + Paths.cache.
    if (fileMod.File && fileMod.Paths?.cache) {
      try {
        const file = new fileMod.File(fileMod.Paths.cache, snapshotFileName(cacheName));
        // textSync throws when missing; text() rejects. Try sync first.
        if (typeof file.textSync === "function") {
          try {
            return parseSnapshot<T>(file.textSync());
          } catch {
            return parseSnapshot<T>(null);
          }
        }
        if (typeof file.text === "function") {
          try {
            return parseSnapshot<T>(await file.text());
          } catch {
            return parseSnapshot<T>(null);
          }
        }
      } catch {
        return parseSnapshot<T>(null);
      }
    }
    // Legacy fallback: FileSystem/legacy readAsStringAsync.
    try {
      const legacy = await import("expo-file-system/legacy");
      const fs = legacy as unknown as {
        cacheDirectory?: string | null;
        readAsStringAsync?: (uri: string) => Promise<string>;
      };
      if (fs.cacheDirectory && fs.readAsStringAsync) {
        const uri = `${fs.cacheDirectory}${snapshotFileName(cacheName)}`;
        try {
          return parseSnapshot<T>(await fs.readAsStringAsync(uri));
        } catch {
          return parseSnapshot<T>(null);
        }
      }
    } catch {
      // No filesystem available (unit tests, web without FS).
    }
    return parseSnapshot<T>(null);
  } catch {
    return parseSnapshot<T>(null);
  }
}

// Writes a cache snapshot file. Best-effort: failures are swallowed.
export async function writeSnapshot<T>(cacheName: string, snapshot: PersistSnapshot<T>): Promise<void> {
  const body = serializeSnapshot(snapshot);
  try {
    const mod = await import("expo-file-system");
    const fileMod = mod as unknown as {
      File?: new (dir: unknown, name: string) => { create?: () => void; write?: (body: string) => void | Promise<void> };
      Paths?: { cache?: unknown };
    };
    if (fileMod.File && fileMod.Paths?.cache) {
      try {
        const file = new fileMod.File(fileMod.Paths.cache, snapshotFileName(cacheName));
        try {
          file.create?.();
        } catch {
          // Already exists; overwrite below.
        }
        await file.write?.(body);
        return;
      } catch {
        // Fall through to legacy attempt.
      }
    }
    try {
      const legacy = await import("expo-file-system/legacy");
      const fs = legacy as unknown as {
        cacheDirectory?: string | null;
        writeAsStringAsync?: (uri: string, body: string) => Promise<void>;
      };
      if (fs.cacheDirectory && fs.writeAsStringAsync) {
        await fs.writeAsStringAsync(`${fs.cacheDirectory}${snapshotFileName(cacheName)}`, body);
      }
    } catch {
      // Swallowed: cache persistence must never break the app.
    }
  } catch {
    // Swallowed.
  }
}
