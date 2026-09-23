import { describe, expect, test } from "bun:test";

import type { NotificationRecord } from "../shared/types";
import { sendDevicePush } from "./device-push";
import { resolveVapidConfig, sendWebPush } from "./web-push";

// web-push rejects with an object carrying statusCode; a real Error with the
// same property exercises the same branch while satisfying the test linter.
function pushError(statusCode: number): Error & { statusCode: number } {
  const error = new Error(`push failed (${statusCode})`) as Error & {
    statusCode: number;
  };
  error.statusCode = statusCode;
  return error;
}

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

describe("web push sender", () => {
  test("is a no-op without VAPID config", async () => {
    const result = await sendWebPush(
      base(),
      [
        {
          auth: "a",
          endpoint: "https://fcm.googleapis.com/fcm/send/1",
          p256dh: "p",
        },
      ],
      { vapid: null }
    );
    expect(result).toEqual({ expired: [], failed: 0, sent: 0 });
  });

  test("sends to every subscription and counts them", async () => {
    let calls = 0;
    const result = await sendWebPush(
      base(),
      [
        {
          auth: "a",
          endpoint: "https://fcm.googleapis.com/fcm/send/1",
          p256dh: "p",
        },
        {
          auth: "b",
          endpoint: "https://fcm.googleapis.com/fcm/send/2",
          p256dh: "q",
        },
      ],
      {
        sendNotification: () => {
          calls += 1;
          return Promise.resolve({});
        },
        vapid: { privateKey: "k", publicKey: "v", subject: "mailto:a@b.c" },
      }
    );
    expect(calls).toBe(2);
    expect(result.sent).toBe(2);
  });

  test("never contacts a non push-service endpoint and prunes it", async () => {
    const contacted: string[] = [];
    const result = await sendWebPush(
      base(),
      [
        { auth: "a", endpoint: "http://169.254.169.254/latest", p256dh: "p" },
        {
          auth: "b",
          endpoint: "https://fcm.googleapis.com/fcm/send/ok",
          p256dh: "q",
        },
      ],
      {
        sendNotification: (subscription) => {
          contacted.push(subscription.endpoint);
          return Promise.resolve({});
        },
        vapid: { privateKey: "k", publicKey: "v", subject: "mailto:a@b.c" },
      }
    );
    expect(contacted).toEqual(["https://fcm.googleapis.com/fcm/send/ok"]);
    expect(result.expired).toEqual(["http://169.254.169.254/latest"]);
    expect(result.sent).toBe(1);
  });

  test("collects 404/410 endpoints for pruning", async () => {
    const result = await sendWebPush(
      base(),
      [
        {
          auth: "a",
          endpoint: "https://fcm.googleapis.com/fcm/send/gone",
          p256dh: "p",
        },
        {
          auth: "b",
          endpoint: "https://fcm.googleapis.com/fcm/send/ok",
          p256dh: "q",
        },
      ],
      {
        sendNotification: (subscription) => {
          if (subscription.endpoint.includes("gone")) {
            return Promise.reject(pushError(410));
          }
          return Promise.resolve({});
        },
        vapid: { privateKey: "k", publicKey: "v", subject: "mailto:a@b.c" },
      }
    );
    expect(result.expired).toEqual([
      "https://fcm.googleapis.com/fcm/send/gone",
    ]);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
  });

  test("counts a non-gone failure without aborting the batch", async () => {
    const result = await sendWebPush(
      base(),
      [
        {
          auth: "a",
          endpoint: "https://fcm.googleapis.com/fcm/send/1",
          p256dh: "p",
        },
        {
          auth: "b",
          endpoint: "https://fcm.googleapis.com/fcm/send/2",
          p256dh: "q",
        },
      ],
      {
        sendNotification: (subscription) =>
          subscription.endpoint.endsWith("/1")
            ? Promise.reject(pushError(500))
            : Promise.resolve({}),
        vapid: { privateKey: "k", publicKey: "v", subject: "mailto:a@b.c" },
      }
    );
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(1);
  });
});

describe("vapid config resolution", () => {
  test("returns null when either key is missing", () => {
    expect(resolveVapidConfig({})).toBeNull();
    expect(resolveVapidConfig({ VAPID_PUBLIC_KEY: "abc" })).toBeNull();
    expect(resolveVapidConfig({ VAPID_PRIVATE_KEY: "def" })).toBeNull();
  });

  test("defaults the subject and trims keys", () => {
    const config = resolveVapidConfig({
      VAPID_PRIVATE_KEY: " def ",
      VAPID_PUBLIC_KEY: " abc ",
    });
    expect(config).toEqual({
      privateKey: "def",
      publicKey: "abc",
      subject: "mailto:hello@asocialmedia.cc",
    });
  });
});

describe("device push sender", () => {
  test("skips tokens that are not Expo tokens", async () => {
    let called = false;
    const result = await sendDevicePush(
      base(),
      [{ platform: "android", provider: "expo", token: "raw-fcm-token" }],
      {
        fetchImpl: (() => {
          called = true;
          return Promise.resolve(new Response("{}"));
        }) as unknown as typeof fetch,
      }
    );
    expect(called).toBe(false);
    expect(result).toEqual({ failed: 0, sent: 0, unregistered: [] });
  });

  test("counts delivered messages from the receipt tickets", async () => {
    const result = await sendDevicePush(
      base(),
      [
        {
          platform: "android",
          provider: "expo",
          token: "ExponentPushToken[aaa]",
        },
      ],
      {
        fetchImpl: (() =>
          Promise.resolve(
            Response.json({ data: { id: "t1", status: "ok" } })
          )) as unknown as typeof fetch,
      }
    );
    expect(result.sent).toBe(1);
  });

  test("collects DeviceNotRegistered tokens for pruning", async () => {
    const result = await sendDevicePush(
      base(),
      [
        {
          platform: "android",
          provider: "expo",
          token: "ExponentPushToken[aaa]",
        },
      ],
      {
        fetchImpl: (() =>
          Promise.resolve(
            Response.json({
              data: {
                details: { error: "DeviceNotRegistered" },
                status: "error",
              },
            })
          )) as unknown as typeof fetch,
      }
    );
    expect(result.unregistered).toEqual(["ExponentPushToken[aaa]"]);
    expect(result.sent).toBe(0);
  });

  test("counts every message as failed when the request itself fails", async () => {
    const result = await sendDevicePush(
      base(),
      [
        {
          platform: "android",
          provider: "expo",
          token: "ExponentPushToken[aaa]",
        },
        {
          platform: "ios",
          provider: "expo",
          token: "ExponentPushToken[bbb]",
        },
      ],
      {
        fetchImpl: (() =>
          Promise.reject(new Error("offline"))) as unknown as typeof fetch,
      }
    );
    expect(result.failed).toBe(2);
    expect(result.sent).toBe(0);
  });
});
