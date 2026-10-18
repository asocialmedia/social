// oxlint-disable promise/avoid-new -- A deferred response verifies stale requests cannot commit after cancellation.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { useConversationPreviewRequests } from "@/components/messages/use-conversation-preview-requests";

import type { MessageChangeNotice } from "./message-change-broadcast";
import { useGlobalMessageSearch } from "./use-global-message-search";

const invalidate = mock(() => {});
const configureScope = mock(() => {});
const emptyConversations: never[] = [];
let recoveryGeneration = 1;
let notifyChange: (notice: MessageChangeNotice) => void = () => {};
let accountId = "global-hook-user";
mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: { id: accountId } }),
}));
mock.module("@/components/messages/message-identity-provider", () => ({
  useMessagesIdentity: () => ({ recoveryGeneration }),
}));
mock.module("./use-decryption", () => ({
  findMyWrappedKeys: () => [],
  findPeerPublicKey: () => null,
  useRootKeyStore: () => null,
}));
mock.module("./decryptor", () => ({
  messageDecryptor: {
    configureScope,
    get: () => {},
    getVersion: () => 0,
    invalidate,
    subscribe: () => () => {},
  },
}));
mock.module("./message-change-broadcast", () => ({
  createMessageChangeBroadcast: (input: {
    onNotice: (notice: MessageChangeNotice) => void;
  }) => {
    notifyChange = input.onNotice;
    return { close: () => {} };
  },
}));

type SearchInput = Parameters<typeof useGlobalMessageSearch>[0];
type Search = ReturnType<typeof useGlobalMessageSearch>;
let dom: Window;
let root: Root;
let search: Search | null;
let props: SearchInput;
let handler: (body: Record<string, unknown>) => Response | Promise<Response>;
const calls: {
  body: Record<string, unknown>;
  signal: AbortSignal | null | undefined;
}[] = [];
const globals = new Map<string, PropertyDescriptor | undefined>();

function Probe(input: SearchInput) {
  const result = useGlobalMessageSearch(input);
  useConversationPreviewRequests(emptyConversations);
  useLayoutEffect(() => {
    search = result;
  }, [result]);
  return null;
}

function current(): Search {
  if (!search) {
    throw new Error("Search did not render");
  }
  return search;
}

function page(
  prefix = "needle",
  options: { expires?: number[]; hasMore?: boolean; start?: number } = {}
): Response {
  return Response.json({
    coverageComplete: true,
    coveragePaused: false,
    hasMore: options.hasMore ?? false,
    hits: Array.from({ length: options.expires?.length ?? 20 }, (_, index) => ({
      ciphertext: "encrypted",
      conversationAvatarMediaId: null,
      conversationId: "conversation-1",
      conversationName: null,
      conversationType: "DM",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: options.expires
        ? new Date(options.expires[index] ?? 0).toISOString()
        : null,
      id: `${prefix}-${(options.start ?? 0) + index}`,
      iv: "iv",
      keyEpoch: 1,
      peerAvatarUrl: null,
      peerName: "Ada",
      peerUsername: "ada",
      ratchetIndex: index,
      revision: 1,
      rootKeyCiphertext: null,
      rootKeyIv: null,
      rootKeyWrapperPublicKey: null,
      senderId: "peer",
      senderName: "Ada",
      senderUsername: "ada",
    })),
    nextCursor: options.hasMore ? "older" : null,
    sessionToken: "session",
  });
}

async function render(overrides: Partial<SearchInput> = {}) {
  props = { ...props, ...overrides };
  await act(() => {
    root.render(<Probe {...props} />);
  });
}

async function settle(predicate: () => boolean) {
  const deadline = Date.now() + 2500;
  while (!predicate() && Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- Let request and React effects settle between state observations.
    await act(async () => {
      await Bun.sleep(10);
    });
  }
  expect(predicate()).toBe(true);
}

beforeEach(() => {
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "IS_REACT_ACT_ENVIRONMENT",
    "fetch",
  ]) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  dom = new Window({ url: "http://localhost:3000" });
  for (const [key, value] of Object.entries({
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    document: dom.document,
    navigator: dom.navigator,
    window: dom,
  })) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
  const container = dom.document.createElement("div");
  dom.document.body.append(container);
  root = createRoot(container as unknown as HTMLElement);
  props = {
    conversationType: "ALL",
    enabled: true,
    query: "needle",
    visible: true,
  };
  search = null;
  accountId = "global-hook-user";
  recoveryGeneration = 1;
  calls.length = 0;
  invalidate.mockClear();
  configureScope.mockClear();
  handler = () => page();
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ body, signal: init?.signal });
      return Promise.resolve(handler(body));
    },
    writable: true,
  });
});

afterEach(async () => {
  await act(() => {
    root.unmount();
  });
  await dom.happyDOM.abort();
  dom.close();
  for (const [key, descriptor] of globals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  globals.clear();
});

describe("global message search lifecycle", () => {
  test("shares the same account and recovery scope with conversation previews", async () => {
    await render();
    expect(configureScope.mock.calls).toHaveLength(2);
    expect(configureScope.mock.calls).toEqual([
      [`${accountId}\u00001`],
      [`${accountId}\u00001`],
    ]);
    recoveryGeneration = 2;
    await render();
    expect(configureScope.mock.calls.slice(-2)).toEqual([
      [`${accountId}\u00002`],
      [`${accountId}\u00002`],
    ]);
  });
  test("ignores superseded responses and clears results during query and account changes", async () => {
    const deferred = Promise.withResolvers<Response>();
    handler = (body) =>
      body.query === "needle" ? deferred.promise : page("new");
    await render();
    await settle(() => calls.length === 1);
    await render({ query: "new query" });
    expect(current().results).toHaveLength(0);
    expect(calls[0]?.signal?.aborted).toBe(true);
    await settle(() => current().results[0]?.hit.id === "new-0");
    await act(async () => {
      deferred.resolve(page("stale"));
      await Bun.sleep(10);
    });
    expect(current().results[0]?.hit.id).toBe("new-0");
    accountId = "other-user";
    handler = () => new Promise(() => {});
    await render();
    expect(current().results).toHaveLength(0);
  });

  test("continues scheduling later expirations after the first visible message expires", async () => {
    handler = () =>
      page("expiry", { expires: [Date.now() + 300, Date.now() + 700] });
    await render();
    await settle(() => current().results.length === 2);
    await act(async () => {
      await Bun.sleep(400);
    });
    expect(current().results).toHaveLength(1);
    expect(current().results[0]?.hit.id).toBe("expiry-1");
    await act(async () => {
      await Bun.sleep(400);
    });
    expect(current().results).toHaveLength(0);
    expect(invalidate).toHaveBeenCalledWith("expiry-1");
  });

  test("removes changed hits immediately and coalesces a burst of cross-tab notices", async () => {
    await render();
    await settle(() => current().results.length === 20);
    handler = () => page("refreshed");
    await act(() => {
      for (let index = 0; index < 5; index += 1) {
        notifyChange({
          accessChanged: false,
          conversationId: "conversation-1",
          messageIds: [],
          resetRequired: false,
          unavailableMessageIds: ["needle-0"],
        });
      }
    });
    expect(
      current().results.some((result) => result.hit.id === "needle-0")
    ).toBe(false);
    await settle(() => current().results[0]?.hit.id === "refreshed-0");
    expect(calls).toHaveLength(2);
    expect(invalidate).toHaveBeenCalledWith("needle-0");
  });

  test("reconciles on reconnect and throttles the following focus event", async () => {
    await render();
    await settle(() => current().results.length === 20);
    handler = () => page("reconnected");
    await act(() => {
      dom.dispatchEvent(new dom.Event("online"));
      dom.dispatchEvent(new dom.Event("focus"));
    });
    await settle(() => current().results[0]?.hit.id === "reconnected-0");
    expect(calls).toHaveLength(2);
  });

  test("keeps loaded hits on page failure and retries the failed continuation", async () => {
    let failPage = true;
    handler = (body) =>
      body.cursor && failPage
        ? new Response(null, { status: 503 })
        : page("needle", { hasMore: true, start: body.cursor ? 20 : 0 });
    await render();
    await settle(() => current().results.length === 20);
    await act(async () => {
      await current().loadMore();
    });
    expect(current().results).toHaveLength(20);
    expect(current().error).toBeTruthy();
    failPage = false;
    await act(async () => {
      await current().loadMore();
    });
    expect(current().results).toHaveLength(40);
    expect(calls[2]?.body.cursor).toBe("older");
    expect(current().error).toBeNull();
  });

  test("restarts evicted sessions and bounds retained results to sixty", async () => {
    let index = 0;
    let expired = false;
    handler = (body) =>
      body.cursor && expired
        ? new Response(null, { status: 409 })
        : page("needle", { hasMore: true, start: (index += 1) * 20 - 20 });
    await render();
    await settle(() => current().results.length === 20);
    for (let count = 0; count < 4; count += 1) {
      // oxlint-disable-next-line no-await-in-loop -- Each continuation depends on the previous page's cursor.
      await act(async () => {
        await current().loadMore();
      });
    }
    expect(current().results).toHaveLength(60);
    expect(current().results[0]?.hit.id).toBe("needle-40");
    expect(invalidate).toHaveBeenCalledWith("needle-99");
    expired = true;
    await act(async () => {
      await current().loadMore();
    });
    expect(current().hasMore).toBe(false);
    expect(current().results).toHaveLength(60);
    expired = false;
    await act(() => {
      current().retry();
    });
    await settle(() => current().results.length === 20);
    expect(calls.at(-1)?.body.sessionToken).toBeUndefined();
    expect(calls.at(-1)?.body.cursor).toBeUndefined();
  });
});
