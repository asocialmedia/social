// Continuation reads advance sequentially within the existing two-page warming budget.
// oxlint-disable no-await-in-loop
import { createHash } from "node:crypto";

import { ProtocolError } from "@asm/protocols/contracts";
import { abortable } from "@asm/protocols/discovery";
import type { DiscoveryPage } from "@asm/protocols/discovery";
import { z } from "zod";

import { discoveryWatchSchema } from "./discovery-live";
import type { DiscoveryStore } from "./discovery-store";

const warmupSchema = z.object({
  cursor: z.string().min(1).max(4096).nullable(),
  head: z.string().length(64),
});

export async function warmDiscoveryInventory(options: {
  head: DiscoveryPage;
  read: (cursor: string) => Promise<DiscoveryPage>;
  retain: (page: DiscoveryPage, startedAt: number) => Promise<void>;
  signal: AbortSignal;
  store: DiscoveryStore;
  watch: z.input<typeof discoveryWatchSchema>;
}) {
  if (options.signal.aborted) {
    return;
  }
  const scope = createHash("sha256")
    .update(JSON.stringify(discoveryWatchSchema.parse(options.watch)))
    .digest("hex");
  const key = `live:depth:v1:${scope}`;
  const owner = crypto.randomUUID();
  if (!(await options.store.acquire(key, owner))) {
    return;
  }
  const lease = { key, owner };
  try {
    const head = createHash("sha256")
      .update(JSON.stringify(options.head.items.map((post) => post.id)))
      .digest("hex");
    const raw = await options.store.get(key);
    const saved = warmupSchema.parse(
      raw ? JSON.parse(raw) : { cursor: options.head.cursor, head }
    );
    if (saved.cursor === null && saved.head === head) {
      return;
    }
    let cursor: string | null = saved.cursor ?? options.head.cursor;
    const chainHead = saved.cursor ? saved.head : head;
    if (
      !cursor ||
      !(await options.store.set(
        key,
        JSON.stringify({ cursor, head: chainHead }),
        300_000,
        lease
      ))
    ) {
      return;
    }
    for (let index = 0; cursor && index < 2; index += 1) {
      options.signal.throwIfAborted();
      const startedAt = Date.now();
      let next: DiscoveryPage;
      try {
        next = await abortable(options.read(cursor), options.signal);
      } catch (error) {
        if (
          error instanceof ProtocolError &&
          error.code === "invalid_input" &&
          options.head.cursor
        ) {
          await options.store.set(
            key,
            JSON.stringify({ cursor: options.head.cursor, head }),
            300_000,
            lease
          );
        }
        throw error;
      }
      options.signal.throwIfAborted();
      await options.retain(next, startedAt);
      if (next.partial && !next.cursor) {
        return;
      }
      ({ cursor } = next);
      if (
        !(await options.store.set(
          key,
          JSON.stringify({ cursor, head: chainHead }),
          cursor ? 300_000 : 60_000,
          lease
        ))
      ) {
        return;
      }
    }
  } finally {
    await options.store.release(key, owner);
  }
}
