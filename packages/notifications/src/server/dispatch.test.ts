import { describe, expect, test } from "bun:test";

import type { NotificationRecord } from "../shared/types";
import { dispatchNotificationPush } from "./dispatch";

function base(): NotificationRecord {
  return {
    comment: null,
    commentId: null,
    community: null,
    communityId: null,
    count: 1,
    createdAt: "2026-09-13T12:00:00.000Z",
    id: "notif-1",
    issuer: {
      avatarUrl: null,
      displayName: "Alice",
      id: "alice",
      username: "alice",
    },
    issuerId: "alice",
    post: {
      community: null,
      content: "Post body",
      id: "post-1234567890",
      isGust: false,
      parentPostId: null,
    },
    postId: "post-1234567890",
    read: false,
    recipientId: "author-1",
    type: "AMPLIFY",
  };
}

describe("push dispatch", () => {
  test("returns a no-op result when the recipient has no registrations", async () => {
    const result = await dispatchNotificationPush(base(), {
      listDeviceTokens: () => Promise.resolve([]),
      listSubscriptions: () => Promise.resolve([]),
      pruneDeviceTokens: () => Promise.resolve(),
      pruneSubscriptions: () => Promise.resolve(),
    });
    expect(result).toEqual({
      device: { failed: 0, sent: 0, unregistered: [] },
      web: { expired: [], failed: 0, sent: 0 },
    });
  });

  test("prunes the endpoints and tokens the services reported dead", async () => {
    const prunedEndpoints: string[] = [];
    const prunedTokens: string[] = [];
    await dispatchNotificationPush(base(), {
      listDeviceTokens: () =>
        Promise.resolve([
          {
            platform: "android",
            provider: "fcm",
            token: "fcm-token-a",
          },
        ]),
      listSubscriptions: () =>
        Promise.resolve([
          {
            auth: "a",
            endpoint: "https://fcm.googleapis.com/fcm/send/gone",
            p256dh: "p",
          },
        ]),
      pruneDeviceTokens: (tokens) => {
        prunedTokens.push(...tokens);
        return Promise.resolve();
      },
      pruneSubscriptions: (endpoints) => {
        prunedEndpoints.push(...endpoints);
        return Promise.resolve();
      },
      sendDevice: () =>
        Promise.resolve({
          failed: 0,
          sent: 0,
          unregistered: ["fcm-token-a"],
        }),
      sendWeb: () =>
        Promise.resolve({
          expired: ["https://fcm.googleapis.com/fcm/send/gone"],
          failed: 0,
          sent: 0,
        }),
      vapid: { privateKey: "k", publicKey: "v", subject: "mailto:a@b.c" },
    });
    expect(prunedEndpoints).toEqual([
      "https://fcm.googleapis.com/fcm/send/gone",
    ]);
    expect(prunedTokens).toEqual(["fcm-token-a"]);
  });

  test("never throws when a transport fails", async () => {
    const result = await dispatchNotificationPush(base(), {
      listDeviceTokens: () => Promise.reject(new Error("db down")),
      listSubscriptions: () => Promise.reject(new Error("db down")),
      pruneDeviceTokens: () => Promise.resolve(),
      pruneSubscriptions: () => Promise.resolve(),
    });
    expect(result.device.sent).toBe(0);
    expect(result.web.sent).toBe(0);
  });

  test("a prune failure does not fail the delivery", async () => {
    const result = await dispatchNotificationPush(base(), {
      listDeviceTokens: () =>
        Promise.resolve([
          {
            platform: "android",
            provider: "fcm",
            token: "fcm-token-a",
          },
        ]),
      listSubscriptions: () => Promise.resolve([]),
      pruneDeviceTokens: () => Promise.reject(new Error("prune down")),
      pruneSubscriptions: () => Promise.resolve(),
      sendDevice: () =>
        Promise.resolve({
          failed: 0,
          sent: 1,
          unregistered: ["fcm-token-a"],
        }),
      vapid: null,
    });
    expect(result.device.sent).toBe(1);
  });
});
