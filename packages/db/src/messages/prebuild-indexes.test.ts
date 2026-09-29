import { describe, expect, test } from "bun:test";

import { prebuildDmIndexes } from "./prebuild-indexes";
import type { PrebuildQueryClient } from "./prebuild-indexes";

const MESSAGES_INDEX = "messages_conversationId_id_idx";
const KEYS_INDEX = "message_conversation_keys_conversationId_ownerUserId_idx";

// Stands in for pg's Client, answering the existence probe from a set of index
// names that are already present and recording every build statement.
function fakeClient(options: { existing?: string[]; invalid?: string[] } = {}) {
  const present = new Set(options.existing);
  const executed: string[] = [];
  const client: PrebuildQueryClient = {
    connect: () => Promise.resolve(),
    end: () => Promise.resolve(),
    query: <T>(text: string, params?: string[]) => {
      if (text.includes("to_regclass")) {
        // params[0] is the qualified name, e.g. "public"."my_index".
        const qualified = (params?.[0] ?? "").replaceAll('"', "");
        const name = qualified.split(".").at(-1) ?? qualified;
        return Promise.resolve({ rows: [{ result: present.has(name) } as T] });
      }
      if (text.includes("indisvalid")) {
        return Promise.resolve({
          rows: (options.invalid ?? []).map((indexname) => ({
            indexname,
          })) as T[],
        });
      }
      executed.push(text);
      const name = /"(?<index>[^"]+)" ON/.exec(text)?.groups?.index;
      if (name) {
        present.add(name);
      }
      return Promise.resolve({ rows: [] as T[] });
    },
  };
  return { client, executed, present };
}

describe("prebuildDmIndexes", () => {
  test("builds every index when none exist", async () => {
    const { client, executed } = fakeClient();
    const result = await prebuildDmIndexes("postgres://unused", {
      createClient: () => client,
    });
    expect(result).toEqual({
      built: [MESSAGES_INDEX, KEYS_INDEX],
      present: [],
    });
    expect(executed).toHaveLength(2);
  });

  test("always uses CREATE INDEX CONCURRENTLY, never a blocking build", async () => {
    const { client, executed } = fakeClient();
    await prebuildDmIndexes("postgres://unused", {
      createClient: () => client,
    });
    expect(executed).toHaveLength(2);
    for (const statement of executed) {
      expect(statement).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS");
    }
  });

  test("skips an index that already exists, because the migration would too", async () => {
    // The migration's createIndex precheck is `to_regclass(...) IS NULL`, so an
    // existing index is skipped there. Pre-building one twice must be a no-op
    // rather than an error.
    const { client, executed } = fakeClient({ existing: [MESSAGES_INDEX] });
    const result = await prebuildDmIndexes("postgres://unused", {
      createClient: () => client,
    });
    expect(result.built).toEqual([KEYS_INDEX]);
    expect(result.present).toEqual([MESSAGES_INDEX]);
    expect(
      executed.some((statement) => statement.includes(MESSAGES_INDEX))
    ).toBe(false);
  });

  test("is idempotent: a second run builds nothing", async () => {
    const { client, executed } = fakeClient();
    await prebuildDmIndexes("postgres://unused", {
      createClient: () => client,
    });
    const second = await prebuildDmIndexes("postgres://unused", {
      createClient: () => client,
    });
    expect(second).toEqual({
      built: [],
      present: [MESSAGES_INDEX, KEYS_INDEX],
    });
    expect(executed).toHaveLength(2);
  });

  test("fails loudly on an INVALID index instead of reporting success", async () => {
    // A concurrent build that errors leaves an INVALID index behind. It still
    // satisfies to_regclass, so the migration would skip the rebuild and ship a
    // broken index. That has to surface here, not as a green run.
    const { client } = fakeClient({ invalid: [MESSAGES_INDEX] });
    await expect(
      prebuildDmIndexes("postgres://unused", { createClient: () => client })
    ).rejects.toThrow(/INVALID/);
  });

  test("closes the connection even when a build fails", async () => {
    let ended = false;
    const client: PrebuildQueryClient = {
      connect: () => Promise.resolve(),
      end: () => {
        ended = true;
        return Promise.resolve();
      },
      query: <T>(text: string) =>
        text.includes("to_regclass")
          ? Promise.resolve({ rows: [{ result: false } as T] })
          : Promise.reject(new Error("disk full")),
    };
    await expect(
      prebuildDmIndexes("postgres://unused", { createClient: () => client })
    ).rejects.toThrow("disk full");
    expect(ended).toBe(true);
  });
});
