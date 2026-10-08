import { describe, expect, test } from "bun:test";

import { hydrateSearchHits } from "./search-hydration";
import type { SearchHydrationHit } from "./search-hydration";

const conversationId = "conversation-1";
const newestHit: SearchHydrationHit = {
  createdAt: "2026-10-08T00:00:02.000Z",
  id: "message-newest",
  keyEpoch: 2,
  ratchetIndex: 8,
  revision: 3,
  senderId: "peer-1",
};
const middleHit: SearchHydrationHit = {
  createdAt: "2026-10-08T00:00:01.000Z",
  id: "message-middle",
  keyEpoch: 2,
  ratchetIndex: 7,
  revision: 1,
  senderId: "peer-1",
};
const hits = [newestHit, middleHit];

function row(hit: SearchHydrationHit) {
  return { ...hit, ciphertext: `ciphertext-${hit.id}`, iv: `iv-${hit.id}` };
}

const failedFetcher: typeof fetch = () =>
  Response.json({ error: "Unavailable" }, { status: 503 });

describe("hydrateSearchHits", () => {
  test("hydrates only current readable results and preserves search order", async () => {
    const fetcher: typeof fetch = () =>
      Response.json({
        deferredIds: [],
        messages: [row(middleHit), row(newestHit)],
        unavailableIds: [],
      });
    const messages = await hydrateSearchHits({
      conversationId,
      fetcher,
      hits,
    });

    expect(messages.map((message) => message.id)).toEqual([
      "message-newest",
      "message-middle",
    ]);
    expect(messages[0]).toMatchObject({
      ciphertext: "ciphertext-message-newest",
      conversationId,
      createdAt: new Date(newestHit.createdAt),
      iv: "iv-message-newest",
      ratchetIndex: 8,
      senderId: "peer-1",
    });
  });

  test("continues deferred ids without retaining a response larger than the cap", async () => {
    const requests: { messages: { id: string; revision: number }[] }[] = [];
    const fetcher: typeof fetch = (_input, init) => {
      requests.push(
        JSON.parse(String(init?.body)) as {
          messages: { id: string; revision: number }[];
        }
      );
      if (requests.length === 1) {
        return Response.json({
          deferredIds: [middleHit.id],
          messages: [row(newestHit)],
          unavailableIds: [],
        });
      }
      return Response.json({
        deferredIds: [],
        messages: [row(middleHit)],
        unavailableIds: [],
      });
    };

    const messages = await hydrateSearchHits({
      conversationId,
      fetcher,
      hits,
    });

    expect(requests).toEqual([
      {
        messages: hits.map(({ id, revision }) => ({ id, revision })),
      },
      { messages: [{ id: middleHit.id, revision: middleHit.revision }] },
    ]);
    expect(messages.map((message) => message.id)).toEqual([
      "message-newest",
      "message-middle",
    ]);
  });

  test("drops a result that became unavailable before hydration", async () => {
    const fetcher: typeof fetch = () =>
      Response.json({
        deferredIds: [],
        messages: [row(newestHit)],
        unavailableIds: [middleHit.id],
      });
    const messages = await hydrateSearchHits({
      conversationId,
      fetcher,
      hits,
    });
    expect(messages.map((message) => message.id)).toEqual(["message-newest"]);
  });

  test("fails closed on revision mismatch, protocol errors, and server failures", async () => {
    const editedRow = { ...row(newestHit), revision: newestHit.revision + 1 };
    const mismatchedRevisionFetcher: typeof fetch = () =>
      Response.json({
        deferredIds: [],
        messages: [editedRow, row(middleHit)],
        unavailableIds: [],
      });
    await expect(
      hydrateSearchHits({
        conversationId,
        fetcher: mismatchedRevisionFetcher,
        hits,
      })
    ).rejects.toThrow("Search results changed");

    await expect(
      hydrateSearchHits({ conversationId, fetcher: failedFetcher, hits })
    ).rejects.toThrow("Search results could not be loaded");
  });
});
