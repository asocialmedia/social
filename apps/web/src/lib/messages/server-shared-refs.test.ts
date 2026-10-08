import { describe, expect, test } from "bun:test";

import { resolveServerSharedRefsPage } from "./server-shared-refs";

function response(value: unknown, ok = true): Response {
  return Response.json(value, {
    headers: { "Content-Type": "application/json" },
    status: ok ? 200 : 503,
  });
}

describe("resolveServerSharedRefsPage", () => {
  test("requests a cursor window around an anchor and preserves both boundaries", async () => {
    const requests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const fetcher: typeof fetch = (input, init) => {
      requests.push({ init, input });
      if (init?.method === "POST") {
        return response({
          deferredIds: [],
          messages: [
            {
              ciphertext: "sealed",
              createdAt: "2026-10-08T10:00:00.000Z",
              id: "message-1",
              iv: "iv",
              keyEpoch: 1,
              ratchetIndex: 2,
              revision: 3,
              senderId: "sender-1",
            },
          ],
          unavailableIds: [],
        });
      }
      return response({
        coverageComplete: true,
        hasMore: true,
        items: [
          {
            createdAt: "2026-10-08T10:00:00.000Z",
            keyEpoch: 1,
            kind: "media",
            mediaKind: "image",
            messageId: "message-1",
            ordinal: 0,
            ratchetIndex: 2,
            requiredId: "media-1",
            revision: 3,
            senderId: "sender-1",
          },
        ],
        nextCursor: null,
        snapshotSequence: 40,
        window: {
          hasNewer: true,
          hasOlder: false,
          newerCursor: "newer-cursor",
          olderCursor: null,
        },
      });
    };
    const page = await resolveServerSharedRefsPage({
      around: {
        createdAt: new Date("2026-10-08T10:00:00.000Z").getTime(),
        messageId: "message-1",
        ordinal: 0,
      },
      conversationId: "conversation-1",
      decrypt: (messages) =>
        new Map([
          [
            messages[0]?.id ?? "",
            {
              images: [{ url: "/api/media/media-1", width: 100 }],
              kind: "image",
              type: "media",
            },
          ],
        ]),
      fetcher,
      kind: "media",
    });

    const url = new URL(String(requests[0]?.input), "http://localhost");
    expect(url.searchParams.get("aroundMessageId")).toBe("message-1");
    expect(url.searchParams.get("aroundOrdinal")).toBe("0");
    expect(page.window).toEqual({
      hasNewer: true,
      hasOlder: false,
      newerCursor: "newer-cursor",
      olderCursor: null,
    });
    expect(page.items).toMatchObject([
      { index: 0, messageId: "message-1", url: "/api/media/media-1" },
    ]);
  });

  test("hydrates unique message ids and resolves display refs only on device", async () => {
    const requests: RequestInit[] = [];
    const fetcher: typeof fetch = (_input, init) => {
      requests.push(init ?? {});
      if (init?.method === "POST") {
        return response({
          deferredIds: [],
          messages: [
            {
              ciphertext: "sealed",
              createdAt: "2026-10-08T10:00:00.000Z",
              id: "message-1",
              iv: "iv",
              keyEpoch: 1,
              ratchetIndex: 2,
              revision: 3,
              senderId: "sender-1",
            },
          ],
          unavailableIds: [],
        });
      }
      return response({
        coverageComplete: true,
        hasMore: false,
        items: [
          {
            createdAt: "2026-10-08T10:00:00.000Z",
            keyEpoch: 1,
            kind: "media",
            mediaKind: "image",
            messageId: "message-1",
            ordinal: 0,
            ratchetIndex: 2,
            requiredId: "media-1",
            revision: 3,
            senderId: "sender-1",
          },
          {
            createdAt: "2026-10-08T10:00:00.000Z",
            keyEpoch: 1,
            kind: "media",
            mediaKind: "image",
            messageId: "message-1",
            ordinal: 1,
            ratchetIndex: 2,
            requiredId: "media-2",
            revision: 3,
            senderId: "sender-1",
          },
        ],
        nextCursor: null,
        snapshotSequence: 40,
      });
    };
    const page = await resolveServerSharedRefsPage({
      conversationId: "conversation-1",
      decrypt: (messages) =>
        new Map([
          [
            messages[0]?.id ?? "",
            {
              images: [
                { url: "/api/media/media-1", width: 100 },
                { url: "/api/media/media-2", width: 200 },
              ],
              kind: "image",
              type: "media",
            },
          ],
        ]),
      fetcher,
      kind: "media",
    });
    expect(requests).toHaveLength(2);
    const hydration = JSON.parse(String(requests[1]?.body)) as {
      messages: { id: string; revision: number }[];
    };
    expect(hydration.messages).toEqual([{ id: "message-1", revision: 3 }]);
    expect(page.items).toMatchObject([
      { index: 0, messageId: "message-1", url: "/api/media/media-1" },
      { index: 1, messageId: "message-1", url: "/api/media/media-2" },
    ]);
  });

  test("rejects malformed and failed server responses instead of returning empty lists", async () => {
    await expect(
      resolveServerSharedRefsPage({
        conversationId: "conversation-1",
        decrypt: () => new Map(),
        fetcher: () => response({ hasMore: "yes", items: [] }),
        kind: "link",
      })
    ).rejects.toThrow("Shared items could not be loaded");
    await expect(
      resolveServerSharedRefsPage({
        conversationId: "conversation-1",
        decrypt: () => new Map(),
        fetcher: () => response({}, false),
        kind: "link",
      })
    ).rejects.toThrow("Shared items could not be loaded");
  });
});
