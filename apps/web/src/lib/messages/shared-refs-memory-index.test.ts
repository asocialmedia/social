// The shared refs contract, run against the in-memory backend.
//
// Both backends run the same suite from shared-refs-store.contract.test.ts. That
// file is a shared suite rather than a test of its own on purpose: bun has no
// IndexedDB, so the memory backend is the one the pure rules can be asserted
// against everywhere, and the browser backend's identical behaviour is asserted
// in indexeddb-search-index.test.ts. One suite means one statement of what a
// store must do, which is the only thing that stops the two from drifting.
//
// The shim is NOT imported here: that would make `indexedDB` globally present and
// the fallback path untestable in the same run.

import { describe, expect, test } from "bun:test";

import { createMemorySearchIndexStore } from "./memory-search-index";
import { runSharedRefsStoreSuite } from "./shared-refs-store.contract.test";

runSharedRefsStoreSuite("memory", () => createMemorySearchIndexStore());

describe("memory store refs wiring", () => {
  test("exposes the whole refs contract", () => {
    const store = createMemorySearchIndexStore();
    expect(typeof store.putSharedRefs).toBe("function");
    expect(typeof store.readSharedRefs).toBe("function");
    expect(typeof store.readSharedRefsCounts).toBe("function");
    expect(typeof store.removeSharedRefs).toBe("function");
  });
});
