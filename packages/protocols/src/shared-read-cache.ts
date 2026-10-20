// Shared-cache followers poll in order and never start duplicate work while a lease is held.
// oxlint-disable no-await-in-loop
import { BoundedCache } from "./cache";
import { ProtocolError } from "./contracts";
import type { BoundedReadQueue } from "./read-queue";
import { abortable, waitForReadRetry } from "./transport";

export interface SharedReadStore {
  get: (key: string) => Promise<string | null>;
  claim: (key: string, owner: string, ttlMs: number) => Promise<boolean>;
  commit: (
    key: string,
    owner: string,
    value: string,
    ttlMs: number
  ) => Promise<boolean>;
  release: (key: string, owner: string) => Promise<unknown>;
}

interface ReadRedis {
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    mode: "PX",
    ttlMs: number,
    condition: "NX"
  ) => Promise<unknown>;
  eval: (
    script: string,
    numberOfKeys: number,
    ...arguments_: (string | number)[]
  ) => Promise<unknown>;
}

export function createRedisReadStore(redis: ReadRedis): SharedReadStore {
  return {
    claim: async (key, owner, ttlMs) =>
      (await redis.set(`${key}:lease`, owner, "PX", ttlMs, "NX")) === "OK",
    commit: async (key, owner, value, ttlMs) =>
      Number(
        await redis.eval(
          "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3]) redis.call('DEL', KEYS[1]) return 1",
          2,
          `${key}:lease`,
          `${key}:result`,
          owner,
          value,
          ttlMs
        )
      ) === 1,
    get: (key) => redis.get(`${key}:result`),
    release: (key, owner) =>
      redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
        1,
        `${key}:lease`,
        owner
      ),
  };
}

export class SharedReadCache<T> {
  private readonly local = new BoundedCache({
    maxBytes: 8 * 1024 * 1024,
    maxEntries: 512,
  });
  private readonly pending = new Map<string, Promise<T>>();
  private readonly shutdown = new AbortController();
  private storeUnavailableUntil = 0;
  private hits = 0;
  private sharedHits = 0;
  private coalesced = 0;
  private readonly maxValueBytes = 512 * 1024;

  private readonly options: {
    parse: (value: unknown) => T;
    queue: BoundedReadQueue;
    store?: SharedReadStore;
    ttlMs: number;
    deadlineMs?: number;
    maxPending?: number;
  };

  constructor(options: SharedReadCache<T>["options"]) {
    this.options = options;
  }

  get stats() {
    return {
      coalesced: this.coalesced,
      hits: this.hits,
      pending: this.pending.size,
      sharedHits: this.sharedHits,
    };
  }

  async read(
    key: string,
    load: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    signal?.throwIfAborted();
    this.shutdown.signal.throwIfAborted();
    const cached = this.decode(this.local.get(key));
    if (cached) {
      this.hits += 1;
      return cached.value;
    }
    let work = this.pending.get(key);
    if (work) {
      this.coalesced += 1;
    } else {
      if (this.pending.size >= (this.options.maxPending ?? 512)) {
        throw new ProtocolError("capacity", "Too many pending searches", 1);
      }
      work = (async () => {
        try {
          return await this.load(key, load);
        } finally {
          this.pending.delete(key);
        }
      })();
      this.pending.set(key, work);
    }
    return await abortable(work, signal ?? this.shutdown.signal);
  }

  close() {
    this.shutdown.abort();
    this.local.clear();
  }

  private decode(raw: string | null): { expiresAt: number; value: T } | null {
    if (!raw || raw.length > this.maxValueBytes) {
      return null;
    }
    try {
      const entry: unknown = JSON.parse(raw);
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("expiresAt" in entry) ||
        typeof entry.expiresAt !== "number" ||
        entry.expiresAt <= Date.now() ||
        !("value" in entry)
      ) {
        return null;
      }
      return {
        expiresAt: entry.expiresAt,
        value: this.options.parse(entry.value),
      };
    } catch {
      return null;
    }
  }

  private async load(key: string, load: () => Promise<T>) {
    const deadlineMs = this.options.deadlineMs ?? 5500;
    const signal = AbortSignal.any([
      this.shutdown.signal,
      AbortSignal.timeout(deadlineMs),
    ]);
    let store =
      Date.now() >= this.storeUnavailableUntil ? this.options.store : undefined;
    const owner = crypto.randomUUID();
    let claimed = false;
    const bounded = <R>(work: Promise<R>) =>
      abortable(work, AbortSignal.any([signal, AbortSignal.timeout(250)]));
    if (store) {
      try {
        for (;;) {
          const entry = this.decode(await bounded(store.get(key)));
          if (entry) {
            this.sharedHits += 1;
            this.local.set(
              key,
              JSON.stringify(entry),
              entry.expiresAt - Date.now()
            );
            return entry.value;
          }
          if (await bounded(store.claim(key, owner, deadlineMs + 1000))) {
            claimed = true;
            // A leader may publish between our first read and lease acquisition.
            const published = this.decode(await bounded(store.get(key)));
            if (published) {
              this.sharedHits += 1;
              await bounded(store.release(key, owner));
              this.local.set(
                key,
                JSON.stringify(published),
                published.expiresAt - Date.now()
              );
              return published.value;
            }
            break;
          }
          await waitForReadRetry(60 + Math.floor(Math.random() * 40), signal);
        }
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
        this.storeUnavailableUntil = Date.now() + 1000;
        if (claimed) {
          try {
            await bounded(store.release(key, owner));
          } catch {
            // The expiring lease also bounds cleanup when Redis is unavailable.
          }
        }
        store = undefined;
        claimed = false;
      }
    }
    try {
      const value = this.options.parse(
        await this.options.queue.run(load, signal)
      );
      const entry = JSON.stringify({
        expiresAt: Date.now() + this.options.ttlMs,
        value,
      });
      if (
        new TextEncoder().encode(entry).byteLength <= this.maxValueBytes &&
        !signal.aborted
      ) {
        let retain = true;
        if (store && claimed) {
          try {
            retain = await bounded(
              store.commit(key, owner, entry, this.options.ttlMs)
            );
          } catch {
            this.storeUnavailableUntil = Date.now() + 1000;
          }
        }
        if (retain) {
          this.local.set(key, entry, this.options.ttlMs);
        }
      }
      return value;
    } finally {
      if (store && claimed) {
        await bounded(store.release(key, owner)).catch(() => null);
      }
    }
  }
}
