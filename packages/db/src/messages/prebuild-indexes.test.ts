import { describe, expect, test } from "bun:test";

import { prebuildDmIndexes } from "./prebuild-indexes";
import type { PrebuildQueryClient } from "./prebuild-indexes";

const MESSAGES_INDEX = "messages_conversationId_id_idx";
const KEYS_INDEX = "message_conversation_keys_conversationId_ownerUserId_idx";
const SHORT_CODE_INDEX = "message_conversations_inviteShortCode_key";

// Stands in for pg's Client, answering the existence probe from a set of index
// names that are already present and recording every build statement.
function fakeClient(
  options: {
    existing?: string[];
    invalid?: string[];
    // Simulates a CREATE INDEX CONCURRENTLY that fails part-way, which is what
    // leaves the INVALID index behind in the first place.
    failBuildOf?: string;
    // A build that fails before it starts, e.g. on an unknown column, so
    // Postgres leaves nothing behind at all.
    failBuildOfLeavingNothing?: string;
  } = {}
) {
  const present = new Set(options.existing);
  // Postgres keeps a half-built concurrent index under its name, marked
  // invalid, so a failed build has to add it to the invalid set as well as to
  // the present set. Modelling only the error would miss the whole point.
  const invalid = new Set(options.invalid);
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
          rows: [...invalid].map((indexname) => ({ indexname })) as T[],
        });
      }
      executed.push(text);
      const name = /"(?<index>[^"]+)" ON/.exec(text)?.groups?.index;
      if (name) {
        present.add(name);
        if (options.failBuildOfLeavingNothing === name) {
          present.delete(name);
          return Promise.reject(new Error(`column "nope" does not exist`));
        }
        if (options.failBuildOf === name) {
          invalid.add(name);
          return Promise.reject(
            new Error(
              "could not build index: canceling statement due to user request"
            )
          );
        }
      }
      return Promise.resolve({ rows: [] as T[] });
    },
  };
  return { client, executed, invalid, present };
}

describe("prebuildDmIndexes", () => {
  test("builds every index when none exist", async () => {
    const { client, executed } = fakeClient();
    const result = await prebuildDmIndexes("postgres://unused", {
      createClient: () => client,
    });
    expect(result).toEqual({
      built: [MESSAGES_INDEX, KEYS_INDEX, SHORT_CODE_INDEX],
      present: [],
    });
    expect(executed).toHaveLength(3);
  });

  test("always uses CREATE INDEX CONCURRENTLY, never a blocking build", async () => {
    const { client, executed } = fakeClient();
    await prebuildDmIndexes("postgres://unused", {
      createClient: () => client,
    });
    expect(executed).toHaveLength(3);
    for (const statement of executed) {
      // UNIQUE indexes match too: the invariant is CONCURRENTLY, which a
      // unique build satisfies exactly as a plain one does.
      expect(statement).toContain("CONCURRENTLY IF NOT EXISTS");
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
    expect(result.built).toEqual([KEYS_INDEX, SHORT_CODE_INDEX]);
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
      present: [MESSAGES_INDEX, KEYS_INDEX, SHORT_CODE_INDEX],
    });
    expect(executed).toHaveLength(3);
  });

  test("the short-code index builds UNIQUE: the live column enforces the door's identity", async () => {
    const { client, executed } = fakeClient();
    await prebuildDmIndexes("postgres://unused", {
      createClient: () => client,
    });
    const shortCodeStatement = executed.find((statement) =>
      statement.includes(SHORT_CODE_INDEX)
    );
    expect(shortCodeStatement).toContain("CREATE UNIQUE INDEX");
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

describe("prebuildDmIndexes when a concurrent build fails part-way", () => {
  test("reports the INVALID index left behind, not just the build error", () => {
    // The dangerous window: the build throws, so a sweep placed after the loop
    // never runs, and the half-built index is still sitting there under its
    // name. The migration's precheck only asks whether the name exists, so it
    // would skip the rebuild and finish with an index Postgres will not use.
    const { client } = fakeClient({ failBuildOf: MESSAGES_INDEX });
    expect(
      prebuildDmIndexes("postgres://unused", { createClient: () => client })
    ).rejects.toThrow(new RegExp(`INVALID.*${MESSAGES_INDEX}`, "s"));
  });

  test("an INVALID leftover is fatal even when every other build succeeded", () => {
    // Same end state, reached without a build error: an index that exists but
    // is unusable must still stop the deploy.
    const { client } = fakeClient({ invalid: [KEYS_INDEX] });
    expect(
      prebuildDmIndexes("postgres://unused", { createClient: () => client })
    ).rejects.toThrow(new RegExp(`INVALID.*${KEYS_INDEX}`, "s"));
  });

  test("still closes the connection when a build fails part-way", async () => {
    const { client } = fakeClient({ failBuildOf: MESSAGES_INDEX });
    let closed = false;
    const closing: PrebuildQueryClient = {
      ...client,
      end: () => {
        closed = true;
        return Promise.resolve();
      },
    };
    await prebuildDmIndexes("postgres://unused", {
      createClient: () => closing,
    }).catch(() => {});
    expect(closed).toBe(true);
  });

  test("reports the build error when the build left nothing behind", () => {
    // Not every failure leaves an invalid index. A build rejected outright
    // leaves no index at all, and then the build error is the only signal, so
    // the sweep must not swallow it.
    const { client } = fakeClient({
      failBuildOfLeavingNothing: MESSAGES_INDEX,
    });
    expect(
      prebuildDmIndexes("postgres://unused", { createClient: () => client })
    ).rejects.toThrow(/does not exist/);
  });

  test("names the invalid index even when a later build also failed", () => {
    // The invalid index is the actionable one: it is what would otherwise be
    // skipped by the migration. It must be reported even though the build
    // error is also present.
    const { client } = fakeClient({ failBuildOf: KEYS_INDEX, invalid: [] });
    expect(
      prebuildDmIndexes("postgres://unused", { createClient: () => client })
    ).rejects.toThrow(new RegExp(`INVALID.*${KEYS_INDEX}`, "s"));
  });
});
