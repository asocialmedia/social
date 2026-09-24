import { describe, expect, test } from "bun:test";

import type { NotificationRecord } from "../shared/types";
import {
  buildFcmMessage,
  FCM_OAUTH_ENDPOINT,
  getFcmAccessToken,
  isFcmToken,
  parseServiceAccount,
  resolveFcmServiceAccount,
  sendFcmPush,
} from "./fcm";

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

// A real RSA key is required to sign the assertion (jose validates the PEM);
// this is a throwaway 2048-bit key generated for the test only.
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQC0L+C1fDVWG/Ub
9K0v2qr+cscF8azCep4ty12NwDHwOcKli0wX0Y6BRLO7PkoRMLbkOb3KLf/qAJ96
qvxlr1b041RC+ZE/CYzYeuqbSGvhAu0rBivo+VIkdSlTQCpWoZ0HiYOzxuq1j/+m
xCY+TTh+DsmQz6OMwDr9Bf65RQhavORGS/fbdcSI3Mq2TRti32sG38tkabO3S7pj
adh5uqKEZk8K9IuAzTZoBxBCfuYoEiqRhzjrbxCfNoKpnIuIteFHeJrTxjRfn2J0
jA1BNbPKu8JMbDIR9yOmlOZsNdNknYVBeHatTCMCaZhB+rjpjvdHKSxni2qOwbBl
YDG64nnVAgMBAAECggEADvas6BVtDn4a4Fv05/T2X1Qj0AwOZ0YsjawGVGfCHeuG
DR5gzteRyI1uiZ22I/BSN+jNqJUiXAn6NIMvm7gwdfzM+hTkqYH/BtlKU2PzxYdr
L7f+/IV7+1gZevborTIVqtMSM2NRCYvwVKaUcHcUOm+68II12FH8dBfD3BnuBC7o
7L4sIiUbXQfruVeR1p4FKRTIcXZeNrR+zwm/oKPMWRmkmnS7XSOWhx3yzCdrB0Ti
2WhOzZXDsYV3n2NpGsBGe1fOQunAhXKpXTlFqJku2fUKpXQm91+YHJTSADO61QLm
KJnGfkPfHYhoqgcTinTx0sSu/BBqsjsdCAlE6AYDfwKBgQDcpSSbhQnbVgh+ZzJ+
WEbmvhn2hAJUYma5BEfStYmK/EywFYoCnct6BYTMsXTy+P7VWFfljfr7Z7JIiqA9
7c5fMR1d0aenzCNwF8qiXtzsXyYCcjlcpcRn0l46DbcE7ty0vr/fw3huK6Lsx/lJ
3zMfj81RPDK/0RNPUlJSX8ZNVwKBgQDRDyVMADDnAT0bxxsHPhuwwNB7/PzfMuZ8
g3Fj2JX8v6zKcJ1F114J3nP3+RM1KxTVIJO3dxvsC72nFurIOTa1NhHI6QA2lSs9
XlkwSCqROg9P7XI+XIgtcGdgYSRgN4kdTIOG8T3gAAbLuTxePyKb0+8ACOt1NKWw
QSj391MKswKBgQDTJqLyxY0aPqngNWfn6xjm5lO4SrpkAMsnEcaeCaZ3wFyvQd2S
BWnc+v0MWmJ9xvUwO9vZzVa7UpAVxbv1p+cPx9O/ncxg0wWy1sHPQxMOjTu1qZPl
aqmbZYFQ8yELcn755XV/cPOGEvJWwER7gkLNWHN24zH5yN4+0ZwAQrFl/wKBgQCx
vlbPjzoEraDvBRGNzthsJwMa57V3bydXpcm6QmMDSVP3qleNEdb6PRAMPNB/2+kS
a2gsDDDJOBI/BdUH9tz0pMvqLW/o+FqTCqx5yGGop9xs8Ey5iKKfP3olD3KF+7Gw
H2WUTXd2A4/DlfIljzg1lLMXLH5EYEae3Eegy77m0QKBgQDOg6PSIsioQrRcVf5t
I7Q4M2DQ9PPi1faoL0wTm06yIpijxK2VotHZyiyWI2aKsEEEIV67ES2XUBGcDXZD
IXBUofLZMqHs8GhfBWTrKxtU0/T/AxVSKC2SVuz4N7wMwlxs5W/wyteR0QziMJho
aCDxQKzaUeesN5fdOfrIVWs5Ug==
-----END PRIVATE KEY-----`;

const TEST_SERVICE_ACCOUNT = {
  client_email: "push@test.iam.gserviceaccount.com",
  private_key: TEST_PRIVATE_KEY,
  project_id: "test-project",
};

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

describe("FCM token detection", () => {
  test("accepts an opaque FCM registration token", () => {
    expect(isFcmToken("dGhpc2lzYW5mY210b2tlbjpleGFtcGxl")).toBe(true);
  });

  test("rejects an Expo token and an empty string", () => {
    expect(isFcmToken("ExponentPushToken[aaa]")).toBe(false);
    expect(isFcmToken("")).toBe(false);
  });
});

describe("service account parsing", () => {
  test("parses the Firebase JSON shape and unescapes newlines", () => {
    const account = parseServiceAccount(JSON.stringify(TEST_SERVICE_ACCOUNT));
    expect(account).not.toBeNull();
    expect(account?.clientEmail).toBe("push@test.iam.gserviceaccount.com");
    expect(account?.projectId).toBe("test-project");
    expect(account?.privateKey).toContain("\n");
    expect(account?.privateKey).not.toContain("\\n");
  });

  test("normalizes an already-unescaped key", () => {
    const account = parseServiceAccount(JSON.stringify(TEST_SERVICE_ACCOUNT));
    expect(account?.privateKey.startsWith("-----BEGIN PRIVATE KEY-----")).toBe(
      true
    );
  });

  test("returns null for missing, empty, or malformed input", () => {
    expect(parseServiceAccount(null)).toBeNull();
    expect(parseServiceAccount("")).toBeNull();
    expect(parseServiceAccount("not json")).toBeNull();
    expect(parseServiceAccount("{}")).toBeNull();
    expect(
      parseServiceAccount(JSON.stringify({ client_email: "a" }))
    ).toBeNull();
  });

  test("resolves from the FCM_SERVICE_ACCOUNT_JSON env var", () => {
    expect(
      resolveFcmServiceAccount({
        FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(TEST_SERVICE_ACCOUNT),
      })
    ).not.toBeNull();
    expect(resolveFcmServiceAccount({})).toBeNull();
  });
});

describe("buildFcmMessage", () => {
  test("maps the payload to FCM's string-only data shape", () => {
    const message = buildFcmMessage(base(), "token-1");
    expect(message.token).toBe("token-1");
    expect(message.notification.title).toBe("Alice");
    expect(message.notification.body).toBe("amplified your post");
    expect(message.data.path).toBe("/posts/post-123");
    expect(message.data.notificationId).toBe("notif-1");
    expect(message.android.collapseKey).toBe("amplify:post-1234567890");
    expect(message.android.notification.tag).toBe("amplify:post-1234567890");
    expect(message.android.notification.channelId).toBe("default");
  });
});

describe("sendFcmPush", () => {
  // A concrete account (not the nullable parser output) keeps the tests free
  // of non-null assertions.
  const account = {
    clientEmail: "push@test.iam.gserviceaccount.com",
    privateKey: TEST_PRIVATE_KEY,
    projectId: "test-project",
  };

  test("is a no-op without a service account", async () => {
    const result = await sendFcmPush(
      base(),
      [{ platform: "android", provider: "fcm", token: "token-1" }],
      { serviceAccount: null }
    );
    expect(result).toEqual({ failed: 0, sent: 0, unregistered: [] });
  });

  test("skips tokens belonging to another provider", async () => {
    let called = false;
    const result = await sendFcmPush(
      base(),
      [{ platform: "android", provider: "expo", token: "token-1" }],
      {
        fetchImpl: (() => {
          called = true;
          return Promise.resolve(new Response("{}"));
        }) as unknown as typeof fetch,
        serviceAccount: account,
      }
    );
    expect(called).toBe(false);
    expect(result.sent).toBe(0);
  });

  test("exchanges the assertion for a token then sends the message", async () => {
    const urls: string[] = [];
    let sentBody: unknown = null;
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("oauth2.googleapis.com")) {
        return Promise.resolve(
          Response.json({ access_token: "ya29.test", expires_in: 3600 })
        );
      }
      sentBody = JSON.parse(String(init?.body ?? "{}"));
      return Promise.resolve(Response.json({ name: "projects/x/messages/1" }));
    }) as unknown as typeof fetch;

    const result = await sendFcmPush(
      base(),
      [{ platform: "android", provider: "fcm", token: "token-1" }],
      { fetchImpl, serviceAccount: account }
    );

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(urls[0]).toContain("oauth2.googleapis.com");
    expect(urls[1]).toBe(
      "https://fcm.googleapis.com/v1/projects/test-project/messages:send"
    );
    expect(sentBody).not.toBeNull();
  });

  test("collects UNREGISTERED tokens for pruning on a 404", async () => {
    const fetchImpl = ((input: RequestInfo | URL) => {
      if (String(input) === FCM_OAUTH_ENDPOINT) {
        return Promise.resolve(
          Response.json({ access_token: "ya29.test", expires_in: 3600 })
        );
      }
      return Promise.resolve(
        Response.json(
          {
            error: {
              details: [{ errorCode: "UNREGISTERED" }],
              status: "NOT_FOUND",
            },
          },
          { status: 404 }
        )
      );
    }) as unknown as typeof fetch;

    const result = await sendFcmPush(
      base(),
      [{ platform: "android", provider: "fcm", token: "dead-token" }],
      { fetchImpl, serviceAccount: account }
    );
    expect(result.unregistered).toEqual(["dead-token"]);
    expect(result.sent).toBe(0);
  });

  test("counts a non-unregistered send error as failed", async () => {
    const fetchImpl = ((input: RequestInfo | URL) => {
      if (String(input) === FCM_OAUTH_ENDPOINT) {
        return Promise.resolve(
          Response.json({ access_token: "ya29.test", expires_in: 3600 })
        );
      }
      return Promise.resolve(new Response("{}", { status: 500 }));
    }) as unknown as typeof fetch;

    const result = await sendFcmPush(
      base(),
      [{ platform: "android", provider: "fcm", token: "token-1" }],
      { fetchImpl, serviceAccount: account }
    );
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
  });

  test("does NOT prune on a 400 INVALID_ARGUMENT (payload errors share that status)", async () => {
    // A malformed token and a malformed payload both yield 400. Pruning here
    // would let one payload bug wipe every user's registration in a single
    // fan-out, so INVALID_ARGUMENT must count as a plain failure instead.
    const fetchImpl = ((input: RequestInfo | URL) => {
      if (String(input) === FCM_OAUTH_ENDPOINT) {
        return Promise.resolve(
          Response.json({ access_token: "ya29.test", expires_in: 3600 })
        );
      }
      return Promise.resolve(
        Response.json(
          {
            error: {
              details: [{ errorCode: "INVALID_ARGUMENT" }],
              message:
                "The registration token is not a valid FCM registration token",
              status: "INVALID_ARGUMENT",
            },
          },
          { status: 400 }
        )
      );
    }) as unknown as typeof fetch;

    const result = await sendFcmPush(
      base(),
      [{ platform: "android", provider: "fcm", token: "malformed" }],
      { fetchImpl, serviceAccount: account }
    );
    expect(result.unregistered).toEqual([]);
    expect(result.failed).toBe(1);
  });

  test("marks every target failed when the token exchange fails", async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response("{}", { status: 401 })
      )) as unknown as typeof fetch;

    const result = await sendFcmPush(
      base(),
      [
        { platform: "android", provider: "fcm", token: "a" },
        { platform: "android", provider: "fcm", token: "b" },
      ],
      { fetchImpl, serviceAccount: account }
    );
    expect(result.failed).toBe(2);
    expect(result.sent).toBe(0);
  });
});

describe("getFcmAccessToken", () => {
  const account = {
    clientEmail: "push@test.iam.gserviceaccount.com",
    privateKey: TEST_PRIVATE_KEY,
    projectId: "test-project",
  };

  test("returns a cached token without a network call when still fresh", async () => {
    let called = false;
    const cache = {
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      token: "cached",
    };
    const result = await getFcmAccessToken(account, {
      cache,
      fetchImpl: (() => {
        called = true;
        return Promise.resolve(Response.json({}));
      }) as unknown as typeof fetch,
    });
    expect(called).toBe(false);
    expect(result?.token).toBe("cached");
  });

  test("refreshes a token that is within the expiry skew", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cache = { expiresAt: now + 10, token: "stale" };
    let called = false;
    const result = await getFcmAccessToken(account, {
      cache,
      fetchImpl: (() => {
        called = true;
        return Promise.resolve(
          Response.json({ access_token: "fresh", expires_in: 3600 })
        );
      }) as unknown as typeof fetch,
      now: () => now * 1000,
    });
    expect(called).toBe(true);
    expect(result?.token).toBe("fresh");
  });

  test("returns null when the exchange is rejected", async () => {
    const result = await getFcmAccessToken(account, {
      fetchImpl: (() =>
        Promise.resolve(
          new Response("{}", { status: 400 })
        )) as unknown as typeof fetch,
    });
    expect(result).toBeNull();
  });
});

describe("FCM send logging", () => {
  const account = {
    clientEmail: "push@test.iam.gserviceaccount.com",
    privateKey: TEST_PRIVATE_KEY,
    projectId: "test-project",
  };

  test("logs a send failure with status and reason but never the token", async () => {
    const { lines, logger } = recordingLogger();
    const fetchImpl = ((input: RequestInfo | URL) => {
      if (String(input) === FCM_OAUTH_ENDPOINT) {
        return Promise.resolve(
          Response.json({ access_token: "ya29.test", expires_in: 3600 })
        );
      }
      return Promise.resolve(new Response("{}", { status: 500 }));
    }) as unknown as typeof fetch;

    await sendFcmPush(
      base(),
      [{ platform: "android", provider: "fcm", token: "SECRET-DEVICE-TOKEN" }],
      { fetchImpl, logger, serviceAccount: account }
    );

    const failure = lines.find((l) => l.message === "push.fcm_send_failed");
    expect(failure?.level).toBe("warn");
    expect(failure?.meta?.status).toBe(500);
    expect(failure?.meta?.platform).toBe("android");
    // The token is a capability to push to that device: never logged.
    expect(JSON.stringify(lines)).not.toContain("SECRET-DEVICE-TOKEN");
  });

  test("logs an auth failure once for the whole batch", async () => {
    const { lines, logger } = recordingLogger();
    const fetchImpl = (() =>
      Promise.resolve(
        new Response("{}", { status: 401 })
      )) as unknown as typeof fetch;

    await sendFcmPush(
      base(),
      [
        { platform: "android", provider: "fcm", token: "a" },
        { platform: "android", provider: "fcm", token: "b" },
      ],
      { fetchImpl, logger, serviceAccount: account }
    );

    const authFailures = lines.filter(
      (l) => l.message === "push.fcm_auth_failed"
    );
    expect(authFailures.length).toBe(1);
    expect(authFailures[0]?.meta?.devices).toBe(2);
  });

  test("does not log when every send succeeds", async () => {
    const { lines, logger } = recordingLogger();
    const fetchImpl = ((input: RequestInfo | URL) => {
      if (String(input) === FCM_OAUTH_ENDPOINT) {
        return Promise.resolve(
          Response.json({ access_token: "ya29.test", expires_in: 3600 })
        );
      }
      return Promise.resolve(Response.json({ name: "projects/x/messages/1" }));
    }) as unknown as typeof fetch;

    await sendFcmPush(
      base(),
      [{ platform: "android", provider: "fcm", token: "token-1" }],
      { fetchImpl, logger, serviceAccount: account }
    );
    expect(lines.length).toBe(0);
  });
});
