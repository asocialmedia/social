import { describe, expect, mock, test } from "bun:test";

import type { SharedRefsPage } from "./shared-refs-format";
import { readSharedRefsPage } from "./shared-refs-page-source";

const serverPage: SharedRefsPage = { hasMore: false, items: [] };
const localPage: SharedRefsPage = {
  after: "local-cursor",
  hasMore: true,
  items: [],
};

function input(
  overrides: Partial<Parameters<typeof readSharedRefsPage>[0]> = {}
) {
  return {
    conversationId: "conversation-1",
    kind: "media" as const,
    limit: 60,
    signal: new AbortController().signal,
    store: {
      readSharedRefs: mock(() => Promise.resolve(localPage)),
    },
    ...overrides,
  };
}

describe("readSharedRefsPage", () => {
  test("uses the server as the primary source", async () => {
    const readServer = mock(() => Promise.resolve(serverPage));
    const request = input({ serverReadPage: readServer });
    await expect(readSharedRefsPage(request)).resolves.toEqual({
      page: serverPage,
      source: "server",
    });
    expect(readServer).toHaveBeenCalledTimes(1);
    expect(request.store?.readSharedRefs).not.toHaveBeenCalled();
  });

  test("falls back to the bounded local cache after an online failure", async () => {
    const readServer = mock(() => Promise.reject(new Error("offline")));
    const request = input({
      after: "cursor",
      serverReadPage: readServer,
    });
    await expect(readSharedRefsPage(request)).resolves.toEqual({
      page: localPage,
      source: "local",
    });
    expect(request.store?.readSharedRefs).toHaveBeenCalledWith(
      "conversation-1",
      "media",
      { after: "cursor", limit: 60 }
    );
  });

  test("does not issue a local fallback after the request was aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const readServer = mock(() => Promise.reject(new Error("aborted")));
    const request = input({
      serverReadPage: readServer,
      signal: controller.signal,
    });
    await expect(readSharedRefsPage(request)).rejects.toThrow("aborted");
    expect(request.store?.readSharedRefs).not.toHaveBeenCalled();
  });

  test("fails closed without a server or local source", async () => {
    await expect(readSharedRefsPage(input({ store: null }))).rejects.toThrow(
      "Shared items are temporarily unavailable"
    );
  });
});
