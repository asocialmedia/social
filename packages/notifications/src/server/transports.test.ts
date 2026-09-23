import { describe, expect, test } from "bun:test";

import type { NotificationRecord } from "../shared/types";
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

function recordingLogger(): {
  lines: { level: string; message: string; meta?: Record<string, unknown> }[];
  logger: {
    error: (message: string, meta?: Record<string, unknown>) => void;
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
  };
} {
  const lines: {
    level: string;
    message: string;
    meta?: Record<string, unknown>;
  }[] = [];
  const push =
    (level: string) => (message: string, meta?: Record<string, unknown>) => {
      lines.push({ level, message, meta });
    };
  return {
    lines,
    logger: { error: push("error"), info: push("info"), warn: push("warn") },
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

describe("web push logging", () => {
  const vapid = { privateKey: "k", publicKey: "v", subject: "mailto:a@b.c" };

  test("logs a failure with host and status but never the endpoint", async () => {
    const { lines, logger } = recordingLogger();
    await sendWebPush(
      base(),
      [
        {
          auth: "a",
          endpoint:
            "https://fcm.googleapis.com/fcm/send/SECRET-SUBSCRIPTION-ID",
          p256dh: "p",
        },
      ],
      {
        logger,
        sendNotification: () => Promise.reject(pushError(500)),
        vapid,
      }
    );

    const failure = lines.find((l) => l.message === "push.web_send_failed");
    expect(failure?.level).toBe("warn");
    expect(failure?.meta?.host).toBe("fcm.googleapis.com");
    expect(failure?.meta?.status).toBe(500);
    expect(JSON.stringify(lines)).not.toContain("SECRET-SUBSCRIPTION-ID");
  });

  test("does not log a gone endpoint as a failure (it is pruned)", async () => {
    const { lines, logger } = recordingLogger();
    await sendWebPush(
      base(),
      [
        {
          auth: "a",
          endpoint: "https://fcm.googleapis.com/send/x",
          p256dh: "p",
        },
      ],
      { logger, sendNotification: () => Promise.reject(pushError(410)), vapid }
    );
    expect(lines.length).toBe(0);
  });

  test("logs a rejected non-push-service endpoint by host only", async () => {
    const { lines, logger } = recordingLogger();
    await sendWebPush(
      base(),
      [{ auth: "a", endpoint: "https://169.254.169.254/SECRET", p256dh: "p" }],
      { logger, sendNotification: () => Promise.resolve({}), vapid }
    );
    const rejected = lines.find(
      (l) => l.message === "push.web_endpoint_rejected"
    );
    expect(rejected).toBeDefined();
    expect(JSON.stringify(lines)).not.toContain("169.254.169.254/SECRET");
  });
});
