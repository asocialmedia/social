import { BoundedCache } from "@asm/protocols/cache";

import type { DiscoveryLease, DiscoveryStore } from "./discovery-store";

export class MemoryDiscoveryStore implements DiscoveryStore {
  private readonly cache: BoundedCache;
  private readonly locks = new Map<
    string,
    { owner: string; expires: number }
  >();
  constructor(options: ConstructorParameters<typeof BoundedCache>[0] = {}) {
    this.cache = new BoundedCache({
      maxBytes: 8 * 1024 * 1024,
      maxEntries: 256,
      ...options,
    });
  }
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.cache.get(key));
  }
  set(
    key: string,
    value: string,
    ttlMs: number,
    lease?: DiscoveryLease
  ): Promise<boolean> {
    if (
      lease &&
      (this.locks.get(lease.key)?.owner !== lease.owner ||
        (this.locks.get(lease.key)?.expires ?? 0) <= Date.now())
    ) {
      return Promise.resolve(false);
    }
    this.cache.set(key, value, ttlMs);
    return Promise.resolve(this.cache.get(key) !== null);
  }
  acquire(key: string, owner: string): Promise<boolean> {
    const now = Date.now();
    for (const [entry, lock] of this.locks) {
      if (lock.expires <= now) {
        this.locks.delete(entry);
      }
    }
    if (this.locks.has(key) || this.locks.size >= 64) {
      return Promise.resolve(false);
    }
    this.locks.set(key, { expires: now + 30_000, owner });
    return Promise.resolve(true);
  }
  release(key: string, owner: string): Promise<void> {
    if (this.locks.get(key)?.owner === owner) {
      this.locks.delete(key);
    }
    return Promise.resolve();
  }
}
