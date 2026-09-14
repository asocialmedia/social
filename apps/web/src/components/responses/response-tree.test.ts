import { describe, expect, test } from "bun:test";

import type { PostData } from "@asm/db";

import {
  buildResponseTree,
  findResponseNode,
  MAX_RESPONSE_DEPTH,
  mergeResponsesWithLive,
} from "./response-tree";

// Only the fields the tree logic reads are populated; the rest of PostData is
// irrelevant to ordering/linking, so a cast keeps the fixture legible.
function makeResponse(
  id: string,
  createdAt: Date,
  parentPostId: string | null = null
): PostData {
  return {
    createdAt,
    id,
    parentPost: null,
    parentPostId,
    rootPostId: parentPostId,
    threadTopId: null,
  } as unknown as PostData;
}

const now = Date.now();
const t = (msAgo: number) => new Date(now - msAgo);

describe("buildResponseTree", () => {
  test("orders top-level responses newest first", () => {
    const tree = buildResponseTree([
      makeResponse("old", t(10_000)),
      makeResponse("new", t(1000)),
    ]);

    expect(tree.map((node) => node.response.id)).toEqual(["new", "old"]);
  });

  test("nests children under their parent and sorts siblings oldest first", () => {
    const tree = buildResponseTree([
      makeResponse("root", t(10_000)),
      makeResponse("child-late", t(1000), "root"),
      makeResponse("child-early", t(5000), "root"),
    ]);

    expect(tree).toHaveLength(1);
    const [root] = tree;
    expect(root?.response.id).toBe("root");
    expect(root?.children.map((child) => child.response.id)).toEqual([
      "child-early",
      "child-late",
    ]);
    expect(root?.children[0]?.depth).toBe(1);
  });

  test("builds a deep chain with increasing depth", () => {
    const tree = buildResponseTree([
      makeResponse("a", t(5000)),
      makeResponse("b", t(4000), "a"),
      makeResponse("c", t(3000), "b"),
    ]);

    let [node] = tree;
    const ids: string[] = [];
    const depths: number[] = [];
    while (node) {
      ids.push(node.response.id);
      depths.push(node.depth);
      [node] = node.children;
    }
    expect(ids).toEqual(["a", "b", "c"]);
    expect(depths).toEqual([0, 1, 2]);
  });

  test("exposes the render depth cap", () => {
    // The renderer clamps indentation past this depth; the constant must stay
    // in lockstep with the eddies renderer.
    expect(MAX_RESPONSE_DEPTH).toBe(6);
  });
});

describe("findResponseNode", () => {
  test("finds a nested node by id", () => {
    const tree = buildResponseTree([
      makeResponse("root", t(5000)),
      makeResponse("child", t(4000), "root"),
      makeResponse("grandchild", t(3000), "child"),
    ]);

    expect(findResponseNode(tree, "grandchild")?.response.id).toBe(
      "grandchild"
    );
    expect(findResponseNode(tree, "missing")).toBeNull();
  });
});

describe("mergeResponsesWithLive", () => {
  test("adds live-only responses and keeps the server copy for overlaps", () => {
    const server = makeResponse("server", t(5000));
    const liveOnly = makeResponse("live", t(1000));
    const overlappingLive = makeResponse("server", t(9000));

    const merged = mergeResponsesWithLive(
      [server],
      new Map([
        ["live", liveOnly],
        ["server", overlappingLive],
      ])
    );

    const byId = new Map(merged.map((response) => [response.id, response]));
    expect(byId.get("live")).toBe(liveOnly);
    // Server wins for a response that also exists in the live store.
    expect(byId.get("server")).toBe(server);
    expect(merged).toHaveLength(2);
  });
});
