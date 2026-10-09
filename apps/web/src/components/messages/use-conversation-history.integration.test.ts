import { afterEach, describe, expect, test } from "bun:test";

import {
  InfiniteQueryObserver,
  isCancelledError,
  QueryClient,
} from "@tanstack/react-query";

import { buildAnchoredMessageWindow } from "@/lib/messages/anchored-window";
import type { MessageData } from "@/lib/messages/types";

import { conversationHistoryOptions } from "./use-conversation-history";

const originalFetch = globalThis.fetch;
const clients: QueryClient[] = [];

function client() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(queryClient);
  return queryClient;
}

function row(sequence: number): MessageData {
  return {
    ciphertext: "ciphertext",
    conversationId: "conversation",
    createdAt: new Date(1_000_000 + sequence),
    deletedAt: null,
    editedAt: null,
    id: `message-${sequence}`,
    iv: "iv",
    ratchetIndex: Math.abs(sequence),
    revision: 1,
    senderId: "peer",
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const queryClient of clients.splice(0)) {
    queryClient.clear();
  }
});

describe("conversation history controller integration", () => {
  test("caps bidirectional pagination at eight pages without losing fetchable seams", async () => {
    const queryClient = client();
    const options = conversationHistoryOptions("conversation");
    const requests: URL[] = [];
    let oldest = 0;
    globalThis.fetch = ((input) => {
      const url = new URL(String(input), "http://localhost");
      requests.push(url);
      const olderCursor = url.searchParams.get("cursor");
      const newerCursor = url.searchParams.get("after");
      if (olderCursor) {
        oldest = Number(olderCursor.slice("message-".length)) - 100;
      } else if (newerCursor) {
        oldest = Number(newerCursor.slice("message-".length)) + 1;
      }
      return Response.json({
        messages: Array.from({ length: 100 }, (_, index) =>
          row(oldest + index)
        ),
        nextCursor: oldest < 0 ? `message-${oldest + 99}` : null,
        previousCursor: `message-${oldest}`,
      });
    }) as typeof fetch;
    await queryClient.fetchInfiniteQuery(options);
    const observer = new InfiniteQueryObserver(queryClient, options);
    const unsubscribe = observer.subscribe(() => {});
    try {
      for (let page = 0; page < 20; page += 1) {
        // oxlint-disable-next-line no-await-in-loop -- real cursor pagination consumes the previous committed page
        const result = await observer.fetchPreviousPage();
        expect(result.data?.pages.length).toBeLessThanOrEqual(8);
        expect(
          result.data?.pages.flatMap((item) => item.messages).length
        ).toBeLessThanOrEqual(800);
      }
      const previous = observer.getCurrentResult().data?.pages.at(-1);
      const result = await observer.fetchNextPage();
      expect(requests.at(-1)?.searchParams.get("after")).toBe(
        previous?.nextCursor
      );
      expect(result.data?.pages.length).toBe(8);
      expect(result.data?.pageParams.length).toBe(8);
      expect(
        requests.every((url) => url.searchParams.get("limit") === "100")
      ).toBe(true);
    } finally {
      unsubscribe();
      observer.destroy();
    }
  });

  test("refetches the selected around-message window rather than replacing it with the tail", async () => {
    const queryClient = client();
    const options = conversationHistoryOptions("conversation");
    const target = row(10);
    queryClient.setQueryData(
      options.queryKey,
      buildAnchoredMessageWindow({
        fetched: {
          anchorIndex: 0,
          messages: [target],
          nextCursor: "newer",
          previousCursor: "older",
        },
        issuedIds: new Set(),
        messageId: target.id,
      })
    );
    let request: URL | undefined;
    globalThis.fetch = ((input) => {
      request = new URL(String(input), "http://localhost");
      return Response.json({
        anchorIndex: 0,
        messages: [target],
        nextCursor: "newer",
        previousCursor: "older",
      });
    }) as typeof fetch;
    const observer = new InfiniteQueryObserver(queryClient, options);
    const unsubscribe = observer.subscribe(() => {});
    try {
      await queryClient.refetchQueries({
        exact: true,
        queryKey: options.queryKey,
      });
      expect(request?.searchParams.get("around")).toBe(target.id);
      expect(request?.searchParams.has("cursor")).toBe(false);
      expect(
        queryClient.getQueryData(options.queryKey)?.pages[0].messages[0].id
      ).toBe(target.id);
    } finally {
      unsubscribe();
      observer.destroy();
    }
  });

  test("cancels network work and rejects late responses after a scope closes", async () => {
    const queryClient = client();
    const options = conversationHistoryOptions("conversation");
    const response = Promise.withResolvers<Response>();
    let signal: AbortSignal | undefined;
    globalThis.fetch = ((_input, init) => {
      signal = init?.signal ?? undefined;
      return response.promise;
    }) as typeof fetch;
    async function readHistory(): Promise<unknown> {
      try {
        return await queryClient.fetchInfiniteQuery(options);
      } catch (error) {
        return error;
      }
    }
    const request = readHistory();
    await queryClient.cancelQueries({
      exact: true,
      queryKey: options.queryKey,
    });
    expect(signal?.aborted).toBe(true);
    response.resolve(
      Response.json({
        messages: [row(1)],
        nextCursor: null,
        previousCursor: null,
      })
    );
    expect(isCancelledError(await request)).toBe(true);
    await Bun.sleep(0);
    expect(queryClient.getQueryData(options.queryKey)).toBeUndefined();
  });
});
