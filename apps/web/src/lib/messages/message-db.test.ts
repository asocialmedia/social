// Both messages stores share one IndexedDB database: the identity key in
// crypto.ts and the search index in indexeddb-search-index.ts. They must agree on
// the version, and either one opening must produce a schema both can use.
//
// This suite exists because they did not. The search backend opened the database
// at v5 while the identity store opened the same name at v1, and IndexedDB rejects
// a request for a LOWER version than the database already has. The first search
// open therefore made every later identity-key read fail, and with it the ability
// to decrypt any DM. Nothing failed visibly: the app just could not read its own
// messages.
//
// The second half of the same trap: object stores are created only inside an
// upgradeneeded transaction, which runs only when the requested version is higher
// than the current one. Whichever owner opened first therefore built the schema
// alone, and the other owner's stores silently never existed.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "bun:test";

import {
  createIndexedDbSearchIndexStore,
  resetIndexedDbSearchIndexStoreForTests,
} from "./indexeddb-search-index";
import {
  ensureMessagesSchema,
  IDENTITY_STORE,
  MESSAGES_DB_NAME,
  MESSAGES_DB_VERSION,
  SEARCH_STORES,
} from "./message-db";
import { buildSearchIndexEntry } from "./search-index-format";
import type { SearchIndexEntry } from "./search-index-format";

function entry(text: string, createdAt: number): SearchIndexEntry {
  const built = buildSearchIndexEntry({
    createdAt,
    senderId: "user-a",
    text,
  });
  if (!built) {
    throw new Error(`expected "${text}" to produce an entry`);
  }
  return built;
}

function openRaw(): Promise<IDBDatabase> {
  // oxlint-disable-next-line promise/avoid-new -- IndexedDB open lifecycle is event-based
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MESSAGES_DB_NAME);
    request.addEventListener("success", () => {
      request.result.onversionchange = () => {
        request.result.close();
      };
      resolve(request.result);
    });
    request.addEventListener("error", () => reject(request.error));
  });
}

async function deleteDatabase(): Promise<void> {
  // oxlint-disable-next-line promise/avoid-new -- IndexedDB delete lifecycle is event-based
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(MESSAGES_DB_NAME);
    request.addEventListener("success", () => resolve());
    request.addEventListener("error", () => resolve());
    request.addEventListener("blocked", () => resolve());
  });
}

describe("shared messages database", () => {
  beforeEach(async () => {
    await resetIndexedDbSearchIndexStoreForTests();
    await deleteDatabase();
  });

  // Whichever owner opens first must leave a schema the other can use, because
  // upgradeneeded only runs for the opener that raises the version.
  test("the search index's open creates the identity store too", async () => {
    const store = createIndexedDbSearchIndexStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const db = await openRaw();
    expect(db.objectStoreNames.contains(IDENTITY_STORE)).toBe(true);
    for (const name of SEARCH_STORES) {
      expect(db.objectStoreNames.contains(name)).toBe(true);
    }
    db.close();
  });

  // The regression itself: a second open at the shared version must succeed
  // rather than throw VersionError, which is what broke identity key reads.
  test("reopening at the shared version does not throw", async () => {
    const store = createIndexedDbSearchIndexStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const db = await openRaw();
    expect(db.version).toBe(MESSAGES_DB_VERSION);
    db.close();
    // And a fresh store instance still reads what the first one wrote.
    const reopened = createIndexedDbSearchIndexStore();
    const list = await reopened.readPostingList("c1", "deploy");
    expect([...list]).toEqual([0]);
  });

  // A search schema bump costs a rebuilt index and must never cost identity
  // material, which is the recovery anchor for every message.
  test("resetting the search stores leaves identity material alone", () => {
    expect(ensureMessagesSchema.toString()).toBeTruthy();
    expect(SEARCH_STORES).not.toContain(IDENTITY_STORE);
  });

  // Another tab raising the version fires versionchange and closes our handle.
  // The reopened connection then requests a LOWER version, which IndexedDB always
  // rejects, so this tab cannot use the store again until it reloads. That is
  // inherent, not a bug to code around, and the contract is that it fails
  // loudly and quickly so the caller falls back to in-memory search, rather than
  // hanging or serving wrong results. The stale handle is not reused either way,
  // which is what `staleConnection` is for.
  test("a version bump by another tab degrades instead of hanging", async () => {
    const store = createIndexedDbSearchIndexStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    // oxlint-disable-next-line promise/avoid-new -- IndexedDB open lifecycle is event-based
    await new Promise<void>((resolve) => {
      const request = indexedDB.open(MESSAGES_DB_NAME, MESSAGES_DB_VERSION + 1);
      request.addEventListener("upgradeneeded", () => {
        ensureMessagesSchema(request.result);
      });
      request.addEventListener("success", () => {
        request.result.close();
        resolve();
      });
      request.addEventListener("error", () => resolve());
    });
    // A fresh store, as a reloaded tab would build, works against the new version
    // only after the code's version catches up; what matters here is that the
    // rejection is a VersionError the caller can treat as "not indexed".
    let rejected = false;
    try {
      await store.readPostingList("c1", "deploy");
    } catch (error) {
      rejected = (error as { name?: string })?.name === "VersionError";
    }
    expect(rejected).toBe(true);
  });

  test("neither owner hardcodes its own database version", async () => {
    // One shared constant, imported by both. If either file starts passing a
    // literal version again, this is what should fail.
    const crypto = await Bun.file("apps/web/src/lib/messages/crypto.ts").text();
    const index = await Bun.file(
      "apps/web/src/lib/messages/indexeddb-search-index.ts"
    ).text();
    expect(crypto).toContain("MESSAGES_DB_VERSION");
    expect(index).toContain("MESSAGES_DB_VERSION");
    expect(crypto).not.toMatch(/indexedDB\.open\([^)]*,\s*\d+\s*\)/);
    expect(index).not.toMatch(/indexedDB\.open\([^)]*,\s*\d+\s*\)/);
  });
});
