import { expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import type { ConversationListItem } from "@/lib/messages/client";
import {
  conversationListQuery,
  useRefreshConversationList,
} from "@/lib/messages/conversation-list-query";
import type { MessageConversationMember } from "@/lib/messages/types";
import { useMessageActivity } from "@/lib/messages/use-message-activity";

import { RecentChatsRail } from "./recent-chats-rail";

const viewer = "recent-chats-viewer";
const now = new Date("2026-11-26T00:00:00.000Z");
let pathname = "/messages";

mock.module("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams({ c: "den/1" }),
}));
mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: { id: viewer } }),
}));

function makeChat(
  id: string,
  name: string,
  unreadCount = 0
): ConversationListItem {
  const type = id.startsWith("den") ? "DEN" : "DM";
  const peer: MessageConversationMember = {
    conversationId: id,
    createdAt: now,
    lastReadAt: null,
    user: {
      avatarUrl: null,
      badge: null,
      badges: [],
      communityMemberships: [],
      displayName: name,
      id: `peer-${id}`,
      messageIdentity: null,
      username: `peer-${id}`,
    },
    userId: `peer-${id}`,
  };
  return {
    conversation: {
      createdAt: now,
      id,
      keys: [],
      members: [peer],
      name: type === "DEN" ? name : null,
      pairKey: null,
      type,
      updatedAt: now,
    },
    isNew: false,
    lastMessage: null,
    unreadCount,
  };
}

function inboxResponse(items: ConversationListItem[]) {
  return {
    conversations: items.map(({ conversation }) => conversation),
    hasMore: false,
    items,
    nextCursor: null,
  };
}

function cacheChats(client: QueryClient, items: ConversationListItem[]) {
  client.setQueryData(
    conversationListQuery(viewer).queryKey,
    inboxResponse(items)
  );
}

function rail(client: QueryClient, userId = viewer) {
  return (
    <QueryClientProvider client={client}>
      <RecentChatsRail userId={userId} />
    </QueryClientProvider>
  );
}

function ActivityHarness() {
  const refresh = useRefreshConversationList(viewer);
  useMessageActivity(refresh, true);
  return <RecentChatsRail userId={viewer} />;
}

test("shows the four newest inbox rows in order, with direct links and unread counts", () => {
  const client = new QueryClient();
  cacheChats(client, [
    makeChat("dm-1", "Ada", 3),
    makeChat("den/1", "Study group"),
    makeChat("dm-2", "Grace"),
    makeChat("den-2", "Book club"),
    makeChat("dm-3", "Older chat"),
  ]);

  const html = renderToString(rail(client));
  expect(html.match(/<li>/g)).toHaveLength(4);
  expect(html.indexOf("Ada")).toBeLessThan(html.indexOf("Study group"));
  expect(html).toContain('href="/messages?c=dm-1"');
  expect(html).toContain('href="/messages?c=den%2F1"');
  expect(html.match(/aria-current="location"/g)).toHaveLength(1);
  expect(html.match(/\d+<!-- --> unread[^<]*/g)).toHaveLength(1);
  expect(html).not.toContain("Older chat");
  expect(renderToString(rail(client, "different-account"))).toBe("");

  pathname = "/discover";
  expect(renderToString(rail(client))).not.toContain("aria-current");
  cacheChats(client, []);
  expect(renderToString(rail(client))).toBe("");
  pathname = "/messages";
});

test("reorders chats and updates unread badges after a live activity event outside Messages", async () => {
  pathname = "/discover";
  const dom = new Window({ url: "http://localhost:3000/discover" });
  const activity = new TransformStream<Uint8Array>();
  const writer = activity.writable.getWriter();
  const fetchMock = mock((input: RequestInfo | URL) => {
    switch (String(input)) {
      case "/api/messages/events": {
        return new Response(activity.readable);
      }
      case "/api/messages/conversations": {
        return Response.json(
          inboxResponse([
            makeChat("den/1", "Study group", 2),
            makeChat("dm-1", "Ada"),
          ])
        );
      }
      default: {
        throw new Error(`Unexpected request: ${String(input)}`);
      }
    }
  });
  const globals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    IS_REACT_ACT_ENVIRONMENT: true,
    document: dom.document,
    fetch: fetchMock,
    window: dom,
  })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const client = new QueryClient();
  try {
    cacheChats(client, [
      makeChat("dm-1", "Ada", 1),
      makeChat("den/1", "Study group"),
    ]);
    await act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <ActivityHarness />
        </QueryClientProvider>
      )
    );
    expect(host.querySelector("li a")?.getAttribute("href")).toBe(
      "/messages?c=dm-1"
    );
    expect(host.querySelector(".sr-only")?.textContent).toBe(
      "1 unread message"
    );

    await act(() =>
      writer.write(
        new TextEncoder().encode(
          'event: message-activity\ndata: {"conversationId":"den/1"}\n\n'
        )
      )
    );
    const deadline = Date.now() + 1000;
    while (
      host.querySelector(".sr-only")?.textContent !== "2 unread messages" &&
      Date.now() < deadline
    ) {
      // oxlint-disable-next-line no-await-in-loop -- Wait for the shared query's async notification and React render.
      await act(async () => {
        await Bun.sleep(10);
      });
    }
    expect(host.querySelector("li a")?.getAttribute("href")).toBe(
      "/messages?c=den%2F1"
    );
    expect(host.querySelector(".sr-only")?.textContent).toBe(
      "2 unread messages"
    );
    expect(host.querySelectorAll(".sr-only")).toHaveLength(1);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/messages/events",
      "/api/messages/conversations",
    ]);
  } finally {
    await act(() => root.unmount());
    await writer.close();
    client.clear();
    await dom.happyDOM.close();
    for (const [key, descriptor] of globals) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
    pathname = "/messages";
  }
});
