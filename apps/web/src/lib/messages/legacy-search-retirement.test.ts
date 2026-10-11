import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { IDBDatabase, IDBObjectStore } from "fake-indexeddb";

import {
  clearLegacySearchIndexData,
  resetIndexedDbSearchIndexStoreForTests,
  runTransaction,
} from "./indexeddb-search-index";
import {
  IDENTITY_STORE,
  OFFLINE_SEARCH_STORES,
  SEARCH_STORES,
  SHARED_REFS_STORES,
} from "./message-db";
import {
  resetSearchIndexStoreForTests,
  retireLegacySearchIndex,
} from "./search-index-backend";

const legacyStores = [...SEARCH_STORES, ...SHARED_REFS_STORES];
const preservedStores = [IDENTITY_STORE, ...OFFLINE_SEARCH_STORES];

beforeEach(async () => {
  resetSearchIndexStoreForTests();
  await resetIndexedDbSearchIndexStoreForTests();
});
afterEach(async () => {
  await resetIndexedDbSearchIndexStoreForTests();
  resetSearchIndexStoreForTests();
});

async function seed(rowsPerStore = 1) {
  await runTransaction(
    [...legacyStores, ...preservedStores],
    "readwrite",
    (tx) => {
      for (const name of legacyStores) {
        for (let row = 0; row < rowsPerStore; row += 1) {
          tx.objectStore(name).put(
            {
              content: `${name}-${row}`,
              dictionary: ["private-normalized-fragment"],
            },
            row
          );
        }
      }
      for (const name of preservedStores) {
        tx.objectStore(name).put(
          { ciphertext: `${name}-encrypted-sentinel`, revision: 7 },
          "preserve"
        );
      }
    }
  );
}

async function countStore(name: string): Promise<number> {
  return await runTransaction(
    [name],
    "readonly",
    (tx) =>
      // eslint-disable-next-line promise/avoid-new -- native IndexedDB request completion is event-based
      new Promise<number>((resolve, reject) => {
        const request = tx.objectStore(name).count();
        request.addEventListener("success", () => resolve(request.result));
        request.addEventListener("error", () => reject(request.error));
      })
  );
}

async function readSentinel(name: string): Promise<unknown> {
  return await runTransaction(
    [name],
    "readonly",
    (tx) =>
      // eslint-disable-next-line promise/avoid-new -- native IndexedDB request completion is event-based
      new Promise<unknown>((resolve, reject) => {
        const request = tx.objectStore(name).get("preserve");
        request.addEventListener("success", () => resolve(request.result));
        request.addEventListener("error", () => reject(request.error));
      })
  );
}

describe("bounded legacy archive retirement", () => {
  test("clears text and reference stores while preserving every identity and offline store", async () => {
    await seed();
    expect(await retireLegacySearchIndex()).toBe(true);
    expect(await Promise.all(legacyStores.map(countStore))).toEqual(
      legacyStores.map(() => 0)
    );
    for (const name of preservedStores) {
      // eslint-disable-next-line no-await-in-loop -- inspect each retained store independently
      expect(await readSentinel(name)).toEqual({
        ciphertext: `${name}-encrypted-sentinel`,
        revision: 7,
      });
    }
  });

  test("large archives require one transaction and never materialize rows or dictionaries", async () => {
    await seed(500);
    const transaction = spyOn(IDBDatabase.prototype, "transaction");
    const clear = spyOn(IDBObjectStore.prototype, "clear");
    const reads = [
      "get",
      "getAll",
      "getAllKeys",
      "openCursor",
      "openKeyCursor",
    ] as const;
    const readers = reads.map((name) => spyOn(IDBObjectStore.prototype, name));
    try {
      expect(await retireLegacySearchIndex()).toBe(true);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(clear).toHaveBeenCalledTimes(legacyStores.length);
      for (const reader of readers) {
        expect(reader).not.toHaveBeenCalled();
      }
    } finally {
      transaction.mockRestore();
      clear.mockRestore();
      for (const reader of readers) {
        reader.mockRestore();
      }
    }
  });

  test("coalesces concurrent cutover calls and caches a completed retirement", async () => {
    await seed();
    const clear = spyOn(IDBObjectStore.prototype, "clear");
    try {
      const first = retireLegacySearchIndex();
      expect(retireLegacySearchIndex()).toBe(first);
      expect(await first).toBe(true);
      expect(retireLegacySearchIndex()).toBe(first);
      expect(clear).toHaveBeenCalledTimes(legacyStores.length);
    } finally {
      clear.mockRestore();
    }
  });

  test("a synchronous clear failure aborts all changes and allows a later retry", async () => {
    await seed();
    const originalClear = IDBObjectStore.prototype.clear;
    let operations = 0;
    const clear = spyOn(IDBObjectStore.prototype, "clear").mockImplementation(
      function clear(this: IDBObjectStore) {
        operations += 1;
        if (operations === 3) {
          throw new Error("storage unavailable");
        }
        return originalClear.call(this);
      }
    );
    try {
      expect(await retireLegacySearchIndex()).toBe(false);
    } finally {
      clear.mockRestore();
    }
    expect(await Promise.all(legacyStores.map(countStore))).toEqual(
      legacyStores.map(() => 1)
    );
    expect(await retireLegacySearchIndex()).toBe(true);
    expect(await Promise.all(legacyStores.map(countStore))).toEqual(
      legacyStores.map(() => 0)
    );
    expect(await readSentinel(IDENTITY_STORE)).toEqual({
      ciphertext: `${IDENTITY_STORE}-encrypted-sentinel`,
      revision: 7,
    });
  });

  test("denied database access is retryable without losing recovery material", async () => {
    const open = spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("Access denied", "SecurityError");
    });
    try {
      expect(await retireLegacySearchIndex()).toBe(false);
    } finally {
      open.mockRestore();
    }
    await seed();
    expect(await retireLegacySearchIndex()).toBe(true);
    expect(await readSentinel(IDENTITY_STORE)).toEqual({
      ciphertext: `${IDENTITY_STORE}-encrypted-sentinel`,
      revision: 7,
    });
  });

  test("unavailable IndexedDB reports failure without opening a fallback archive", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });
    try {
      expect(await clearLegacySearchIndexData()).toBe(false);
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, "indexedDB", descriptor);
      }
    }
  });

  test("synchronous transaction callbacks cannot commit earlier writes after throwing", async () => {
    await seed();
    await expect(
      runTransaction([SEARCH_STORES[0]], "readwrite", (tx) => {
        tx.objectStore(SEARCH_STORES[0]).put("partial write", "partial");
        throw new Error("callback failed");
      })
    ).rejects.toThrow("callback failed");
    expect(await countStore(SEARCH_STORES[0])).toBe(1);
  });
});
