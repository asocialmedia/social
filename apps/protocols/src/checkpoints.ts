import { createHash } from "node:crypto";

import { jetstreamRecordUri, jetstreamUrl } from "@asm/protocols/jetstream";
import type {
  JetstreamEvent,
  JetstreamOptions,
} from "@asm/protocols/jetstream";
import type Redis from "ioredis";

export interface CheckpointStore {
  acquire: () => Promise<boolean>;
  renew: () => Promise<boolean>;
  release: () => Promise<void>;
  load: () => Promise<number | undefined>;
  commit: (event: JetstreamEvent) => Promise<void>;
}

const releaseScript =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";
const renewScript =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end return 0";
const commitScript = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local previous = tonumber(redis.call('GET', KEYS[2]) or '-1')
if tonumber(ARGV[2]) > previous then
  redis.call('SET', KEYS[2], ARGV[2])
  redis.call('PUBLISH', ARGV[3], ARGV[4])
end
return 1
`;

export class RedisCheckpointStore implements CheckpointStore {
  readonly scope: string;
  private readonly redis: Pick<Redis, "get" | "set" | "eval">;
  private readonly owner: string;
  private readonly leaseMs: number;

  constructor(
    redis: Pick<Redis, "get" | "set" | "eval">,
    options: Pick<JetstreamOptions, "dids" | "endpoint"> & {
      owner?: string;
      leaseMs?: number;
    }
  ) {
    this.redis = redis;
    this.owner = options.owner ?? crypto.randomUUID();
    this.leaseMs = options.leaseMs ?? 30_000;
    if (!Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1000) {
      throw new RangeError("Lease duration must be at least one second");
    }
    this.scope = `asm:protocols:jetstream:v2:${createHash("sha256").update(jetstreamUrl(options)).digest("hex").slice(0, 32)}`;
  }

  async acquire(): Promise<boolean> {
    return (
      (await this.redis.set(
        `${this.scope}:lease`,
        this.owner,
        "PX",
        this.leaseMs,
        "NX"
      )) === "OK"
    );
  }
  async renew(): Promise<boolean> {
    return (
      (await this.redis.eval(
        renewScript,
        1,
        `${this.scope}:lease`,
        this.owner,
        this.leaseMs
      )) === 1
    );
  }
  async release(): Promise<void> {
    await this.redis.eval(releaseScript, 1, `${this.scope}:lease`, this.owner);
  }
  async load(): Promise<number | undefined> {
    const stored = await this.redis.get(`${this.scope}:cursor`);
    if (stored === null) {
      return undefined;
    }
    const cursor = Number(stored);
    if (!/^\d+$/.test(stored) || !Number.isSafeInteger(cursor) || cursor < 0) {
      throw new Error("Invalid Jetstream checkpoint");
    }
    return cursor;
  }
  async commit(event: JetstreamEvent): Promise<void> {
    const notification = JSON.stringify({
      did: event.did,
      kind: event.kind,
      seq: event.seq,
      source: "bluesky",
      ...(event.kind === "commit"
        ? { operation: event.commit.operation, uri: jetstreamRecordUri(event) }
        : {}),
    });
    const committed = await this.redis.eval(
      commitScript,
      2,
      `${this.scope}:lease`,
      `${this.scope}:cursor`,
      this.owner,
      event.seq,
      "asm:protocols:invalidations",
      notification
    );
    if (committed !== 1) {
      throw new Error("Jetstream lease is no longer owned");
    }
  }
}
