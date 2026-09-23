import { describe, expect, test } from "bun:test";

import {
  dismissNotifications,
  fetchNotificationsPage,
  fetchUnreadCount,
  groupFetchedNotifications,
  markAllNotificationsRead,
} from "./notifications-api";
import type { NotificationItem } from "./notifications-api";

const API_BASE = "https://api.test";

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    headers: { "content-type": "application/json" },
    status,
  });
}

function rawNotification(overrides: Record<string, unknown> = {}): unknown {
  return {
    comment: null,
    commentId: null,
    community: null,
    communityId: null,
    count: 1,
    createdAt: "2026-09-13T12:00:00.000Z",
    id: "notif-1",
    issuer: {
      avatarUrl: "https://cdn.test/a.jpg",
      displayName: "Alice",
      id: "alice",
      username: "alice",
    },
    issuerId: "alice",
    post: {
      community: null,
      content: "Post body",
      id: "post-1",
      isGust: false,
      parentPostId: null,
    },
    postId: "post-1",
    read: false,
    recipientId: "author-1",
    type: "AMPLIFY",
    ...overrides,
  };
}

describe("fetchNotificationsPage", () => {
  test("parses rows and the next cursor", async () => {
    const page = await fetchNotificationsPage("all", null, {
      apiBase: API_BASE,
      baseFetch: (() =>
        Promise.resolve(
          jsonResponse({
            nextCursor: "cursor-2",
            notifications: [rawNotification()],
          })
        )) as unknown as typeof fetch,
    });
    expect(page.nextCursor).toBe("cursor-2");
    expect(page.notifications.length).toBe(1);
    expect(page.notifications[0]?.id).toBe("notif-1");
    expect(page.notifications[0]?.issuer.displayName).toBe("Alice");
    expect(page.notifications[0]?.createdAt).toBe("2026-09-13T12:00:00.000Z");
  });

  test("drops rows with an unknown type instead of crashing a render", async () => {
    const page = await fetchNotificationsPage("all", null, {
      apiBase: API_BASE,
      baseFetch: (() =>
        Promise.resolve(
          jsonResponse({
            nextCursor: null,
            notifications: [
              rawNotification(),
              rawNotification({ id: "bad", type: "NOT_A_TYPE" }),
              rawNotification({ id: "bad-2", issuer: null }),
            ],
          })
        )) as unknown as typeof fetch,
    });
    expect(page.notifications.map((item) => item.id)).toEqual(["notif-1"]);
  });

  test("sends the tab as `type` and the cursor when present", async () => {
    let url = "";
    await fetchNotificationsPage("mentions", "cursor-9", {
      apiBase: API_BASE,
      baseFetch: ((input: RequestInfo | URL) => {
        url = String(input);
        return Promise.resolve(
          jsonResponse({ nextCursor: null, notifications: [] })
        );
      }) as unknown as typeof fetch,
    });
    expect(url).toContain("type=mentions");
    expect(url).toContain("cursor=cursor-9");
  });

  test("throws on a non-ok response", async () => {
    await expect(
      fetchNotificationsPage("all", null, {
        apiBase: API_BASE,
        baseFetch: (() =>
          Promise.resolve(
            new Response("nope", { status: 500 })
          )) as unknown as typeof fetch,
      })
    ).rejects.toThrow();
  });
});

describe("groupFetchedNotifications", () => {
  test("folds amplifies of the same post", () => {
    const items: NotificationItem[] = [
      {
        comment: null,
        commentId: null,
        community: null,
        communityId: null,
        count: 1,
        createdAt: "2026-09-13T12:00:00.000Z",
        id: "n1",
        issuer: { avatarUrl: null, displayName: "A", id: "a", username: "a" },
        issuerId: "a",
        post: null,
        postId: "post-1",
        read: false,
        recipientId: "me",
        type: "AMPLIFY",
      },
      {
        comment: null,
        commentId: null,
        community: null,
        communityId: null,
        count: 1,
        createdAt: "2026-09-13T13:00:00.000Z",
        id: "n2",
        issuer: { avatarUrl: null, displayName: "B", id: "b", username: "b" },
        issuerId: "b",
        post: null,
        postId: "post-1",
        read: false,
        recipientId: "me",
        type: "AMPLIFY",
      },
    ];
    const grouped = groupFetchedNotifications(items);
    expect(grouped.length).toBe(1);
    expect(grouped[0]?.allNotificationIds).toEqual(["n1", "n2"]);
  });
});

describe("unread + mutations", () => {
  test("reads the unread count", async () => {
    const count = await fetchUnreadCount({
      apiBase: API_BASE,
      baseFetch: (() =>
        Promise.resolve(
          jsonResponse({ unreadCount: 7 })
        )) as unknown as typeof fetch,
    });
    expect(count).toBe(7);
  });

  test("marks all read with PATCH", async () => {
    let method = "";
    await markAllNotificationsRead({
      apiBase: API_BASE,
      baseFetch: ((_input: RequestInfo | URL, init?: RequestInit) => {
        method = init?.method ?? "";
        return Promise.resolve(jsonResponse({ success: true }));
      }) as unknown as typeof fetch,
    });
    expect(method).toBe("PATCH");
  });

  test("dismisses a grouped set as comma-separated ids with DELETE", async () => {
    let url = "";
    let method = "";
    await dismissNotifications(["a", "b"], {
      apiBase: API_BASE,
      baseFetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        url = String(input);
        method = init?.method ?? "";
        return Promise.resolve(jsonResponse({ success: true }));
      }) as unknown as typeof fetch,
    });
    expect(url).toContain("/api/notifications/a,b");
    expect(method).toBe("DELETE");
  });

  test("skips the request entirely for an empty dismiss list", async () => {
    let called = false;
    await dismissNotifications([], {
      apiBase: API_BASE,
      baseFetch: (() => {
        called = true;
        return Promise.resolve(jsonResponse({}));
      }) as unknown as typeof fetch,
    });
    expect(called).toBe(false);
  });
});
