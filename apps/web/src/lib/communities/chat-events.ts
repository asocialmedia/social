import type { CommunityChatChange } from "@asm/messages";

export function createCommunityChatLiveEventCache(
  maxEntries = 128,
  maxBytes = 4 * 1024 * 1024
) {
  const cache = new Map<
    string,
    { bytes: Uint8Array; event: CommunityChatChange; raw: string; size: number }
  >();
  const encoder = new TextEncoder();
  let cachedBytes = 0;
  return (roomId: string, raw: string) => {
    const cached = cache.get(roomId);
    if (cached?.raw === raw) {
      return cached;
    }
    if (raw.length > 64 * 1024) {
      return null;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
    if (
      typeof value !== "object" ||
      value === null ||
      !("roomId" in value) ||
      value.roomId !== roomId ||
      !("changeSequence" in value) ||
      typeof value.changeSequence !== "string" ||
      !/^[0-9]{1,19}$/u.test(value.changeSequence) ||
      !("kind" in value) ||
      typeof value.kind !== "string"
    ) {
      return null;
    }
    const event = value as CommunityChatChange;
    const bytes = encoder.encode(
      `id: ${event.changeSequence}\nevent: change\ndata: ${raw}\n\n`
    );
    const entry = {
      bytes,
      event,
      raw,
      size: raw.length * 2 + bytes.byteLength,
    };
    if (cached) {
      cachedBytes -= cached.size;
      cache.delete(roomId);
    }
    cache.set(roomId, entry);
    cachedBytes += entry.size;
    while (cache.size > maxEntries || cachedBytes > maxBytes) {
      const oldest = cache.entries().next().value;
      if (!oldest) {
        break;
      }
      cachedBytes -= oldest[1].size;
      cache.delete(oldest[0]);
    }
    return entry;
  };
}

export const decodeCommunityChatLiveEvent = createCommunityChatLiveEventCache();
