import { describe, expect, test } from "bun:test";

import type { PostData } from "../client";
import { getPostAncestorsWithStore } from "./ancestors";
import type { AncestorStore } from "./ancestors";

function createStore(options: {
  ancestorIds?: string[];
  failTraversal?: boolean;
  parentIds?: Record<string, string | null>;
}): { calls: string[]; store: AncestorStore } {
  const calls: string[] = [];
  const parentIds = Object.entries(options.parentIds ?? {});
  let parentIndex = 0;
  const store: AncestorStore = {
    findAncestorIds: () => {
      calls.push("ancestors");
      if (options.failTraversal) {
        return Promise.reject(new Error("ancestor traversal failed in test"));
      }
      return Promise.resolve(options.ancestorIds ?? []);
    },
    findParentId: () => {
      calls.push("parent");
      const parentId = parentIds[parentIndex];
      parentIndex += 1;
      return Promise.resolve(parentId?.[1] ?? null);
    },
    findPosts: (ids) => {
      calls.push(`posts:${ids.join(",")}`);
      return Promise.resolve([] as unknown as PostData[]);
    },
  };
  return { calls, store };
}

describe("getPostAncestorsWithStore", () => {
  test("returns empty array when no parent exists", async () => {
    const { store } = createStore({});
    const result = await getPostAncestorsWithStore("", "user-1", store);
    expect(result).toEqual([]);
  });

  test("uses the ancestor result to load visible posts", async () => {
    const { calls, store } = createStore({ ancestorIds: ["root", "parent"] });
    const result = await getPostAncestorsWithStore("parent", "user-1", store);
    expect(result).toEqual([]);
    expect(calls).toEqual(["ancestors", "posts:root,parent"]);
  });

  test("falls back to sequential traversal when the first read fails", async () => {
    const { calls, store } = createStore({
      failTraversal: true,
      parentIds: { parent: "root", root: null },
    });
    const result = await getPostAncestorsWithStore("parent", "user-1", store);
    expect(result).toEqual([]);
    expect(calls).toEqual([
      "ancestors",
      "parent",
      "parent",
      "posts:root,parent",
    ]);
  });

  test("loads posts through the same visibility-aware store on fallback", async () => {
    const { calls, store } = createStore({
      failTraversal: true,
      parentIds: { parent: null },
    });
    await getPostAncestorsWithStore("parent", "guest", store);
    expect(calls).toContain("posts:parent");
  });
});
