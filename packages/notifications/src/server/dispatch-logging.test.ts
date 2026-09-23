import { beforeEach, describe, expect, test } from "bun:test";

import type { NotificationRecord } from "../shared/types";
import {
  dispatchNotificationPush,
  resetUnconfiguredWarningForTests,
} from "./dispatch";
import type { PushLogger } from "./log";

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

// Records every line so a test can assert on event names without a real logger.
function recordingLogger(): {
  lines: { level: string; message: string; meta?: Record<string, unknown> }[];
  logger: PushLogger;
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
    logger: {
      error: push("error"),
      info: push("info"),
      warn: push("warn"),
    },
  };
}

describe("dispatch logging", () => {
  // The warning is once-per-process by design, so a test that asserts it must
  // clear the flag rather than depend on which file ran first.
  beforeEach(() => {
    resetUnconfiguredWarningForTests();
  });

  test("logs a summary with both transports' counts on success", async () => {
    const { lines, logger } = recordingLogger();
    await dispatchNotificationPush(base(), {
      listDeviceTokens: () =>
        Promise.resolve([
          { platform: "android", provider: "fcm", token: "fcm-token-a" },
        ]),
      listSubscriptions: () =>
        Promise.resolve([
          {
            auth: "a",
            endpoint: "https://fcm.googleapis.com/send/x",
            p256dh: "p",
          },
        ]),
      logger,
      pruneDeviceTokens: () => Promise.resolve(),
      pruneSubscriptions: () => Promise.resolve(),
      sendDevice: () =>
        Promise.resolve({ failed: 0, sent: 1, unregistered: [] }),
      sendWeb: () => Promise.resolve({ expired: [], failed: 0, sent: 1 }),
      vapid: { privateKey: "k", publicKey: "v", subject: "mailto:a@b.c" },
    });

    const summary = lines.find((line) => line.message === "push.dispatched");
    expect(summary).toBeDefined();
    expect(summary?.meta).toMatchObject({
      deviceSent: 1,
      recipientId: "author-1",
      webSent: 1,
    });
  });

  test("forwards the logger into both transports", async () => {
    const { logger } = recordingLogger();
    let webLogger: unknown = null;
    let deviceLogger: unknown = null;
    await dispatchNotificationPush(base(), {
      listDeviceTokens: () =>
        Promise.resolve([
          { platform: "android", provider: "fcm", token: "fcm-token-a" },
        ]),
      listSubscriptions: () =>
        Promise.resolve([
          {
            auth: "a",
            endpoint: "https://fcm.googleapis.com/send/x",
            p256dh: "p",
          },
        ]),
      logger,
      pruneDeviceTokens: () => Promise.resolve(),
      pruneSubscriptions: () => Promise.resolve(),
      sendDevice: (_n, _t, options) => {
        deviceLogger = options?.logger;
        return Promise.resolve({ failed: 0, sent: 1, unregistered: [] });
      },
      sendWeb: (_n, _s, options) => {
        webLogger = options?.logger;
        return Promise.resolve({ expired: [], failed: 0, sent: 1 });
      },
      vapid: { privateKey: "k", publicKey: "v", subject: "mailto:a@b.c" },
    });
    expect(deviceLogger).toBe(logger);
    expect(webLogger).toBe(logger);
  });

  test("warns once when VAPID is unset so a missing secret is visible", async () => {
    const { lines, logger } = recordingLogger();
    const deps = {
      listDeviceTokens: () => Promise.resolve([]),
      listSubscriptions: () =>
        Promise.resolve([
          {
            auth: "a",
            endpoint: "https://fcm.googleapis.com/send/x",
            p256dh: "p",
          },
        ]),
      logger,
      pruneDeviceTokens: () => Promise.resolve(),
      pruneSubscriptions: () => Promise.resolve(),
      sendDevice: () =>
        Promise.resolve({ failed: 0, sent: 0, unregistered: [] }),
      sendWeb: () => Promise.resolve({ expired: [], failed: 0, sent: 0 }),
      vapid: null,
    };
    await dispatchNotificationPush(base(), deps);
    await dispatchNotificationPush(base(), deps);

    const warnings = lines.filter(
      (line) => line.message === "push.transport_unconfigured"
    );
    // Once per process, not once per notification.
    expect(warnings.length).toBe(1);
    expect(warnings[0]?.meta?.missing).toBe("vapid");
  });

  test("does not warn when VAPID is configured", async () => {
    const { lines, logger } = recordingLogger();
    await dispatchNotificationPush(base(), {
      listDeviceTokens: () => Promise.resolve([]),
      listSubscriptions: () =>
        Promise.resolve([
          {
            auth: "a",
            endpoint: "https://fcm.googleapis.com/send/x",
            p256dh: "p",
          },
        ]),
      logger,
      pruneDeviceTokens: () => Promise.resolve(),
      pruneSubscriptions: () => Promise.resolve(),
      sendWeb: () => Promise.resolve({ expired: [], failed: 0, sent: 1 }),
      vapid: { privateKey: "k", publicKey: "v", subject: "mailto:a@b.c" },
    });
    expect(
      lines.some((line) => line.message === "push.transport_unconfigured")
    ).toBe(false);
  });

  test("logs once per call when the whole dispatch throws", async () => {
    const { lines, logger } = recordingLogger();
    await dispatchNotificationPush(base(), {
      listDeviceTokens: () => Promise.reject(new Error("db down")),
      listSubscriptions: () => Promise.reject(new Error("db down")),
      logger,
      pruneDeviceTokens: () => Promise.resolve(),
      pruneSubscriptions: () => Promise.resolve(),
    });
    const failure = lines.find(
      (line) => line.message === "push.dispatch_failed"
    );
    expect(failure?.level).toBe("error");
    expect(failure?.meta?.recipientId).toBe("author-1");
  });
});
