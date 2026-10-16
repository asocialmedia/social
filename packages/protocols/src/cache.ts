export interface ProtocolCache {
  get: (key: string) => string | null;
  set: (key: string, value: string, ttlMs: number) => void;
  clear: () => void;
}

export class BoundedCache implements ProtocolCache {
  private readonly entries = new Map<
    string,
    { value: string; expiresAt: number; bytes: number }
  >();
  private bytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  constructor(
    options: { maxEntries?: number; maxBytes?: number; now?: () => number } = {}
  ) {
    this.maxEntries = options.maxEntries ?? 256;
    this.maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
    this.now = options.now ?? Date.now;
    if (
      !Number.isSafeInteger(this.maxEntries) ||
      this.maxEntries < 1 ||
      !Number.isSafeInteger(this.maxBytes) ||
      this.maxBytes < 1
    ) {
      throw new RangeError("Cache limits must be positive safe integers");
    }
  }
  get size() {
    return this.entries.size;
  }
  get byteSize() {
    return this.bytes;
  }
  get(key: string): string | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= this.now()) {
      this.remove(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: string, ttlMs: number): void {
    this.remove(key);
    const bytes = new TextEncoder().encode(key + value).byteLength;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || bytes > this.maxBytes) {
      return;
    }
    for (const [entryKey, entry] of this.entries) {
      if (entry.expiresAt <= this.now()) {
        this.remove(entryKey);
      }
    }
    while (
      this.entries.size >= this.maxEntries ||
      this.bytes + bytes > this.maxBytes
    ) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.remove(oldest);
    }
    this.entries.set(key, { bytes, expiresAt: this.now() + ttlMs, value });
    this.bytes += bytes;
  }
  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      this.bytes -= entry.bytes;
      this.entries.delete(key);
    }
  }
}
