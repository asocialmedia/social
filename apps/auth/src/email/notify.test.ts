import { beforeEach, describe, expect, mock, test } from "bun:test";

// The retry loop is the part of the notice pipeline worth asserting on: it must
// retry transient failures, stop on success, give up after the attempt budget,
// and never throw at the caller.

const attempts: string[] = [];
let outcomes: { success: boolean; error?: string }[] = [];
let loggerCalls: { level: string; msg: string }[] = [];

mock.module("@asm/logger", () => ({
  createLogger: () => ({
    error: (_fields: unknown, msg: string) => {
      loggerCalls.push({ level: "error", msg });
    },
    info: (_fields: unknown, msg: string) => {
      loggerCalls.push({ level: "info", msg });
    },
    warn: (_fields: unknown, msg: string) => {
      loggerCalls.push({ level: "warn", msg });
    },
  }),
}));

const sendSocialAccountNotice = mock(() => {
  attempts.push("send");
  return Promise.resolve(outcomes.shift() ?? { success: true });
});

mock.module("./notice-senders", () => ({
  sendAccountMergedNotice: sendSocialAccountNotice,
  sendBackupCodesRegeneratedNotice: sendSocialAccountNotice,
  sendEmailChangedNotice: sendSocialAccountNotice,
  sendMessageKeyResetNotice: sendSocialAccountNotice,
  sendNewClientLoginNotice: sendSocialAccountNotice,
  sendPasskeyChangedNotice: sendSocialAccountNotice,
  sendPasswordChangedNotice: sendSocialAccountNotice,
  sendSocialAccountNotice,
  sendTwoFactorChangedNotice: sendSocialAccountNotice,
  sendUsernameChangedNotice: sendSocialAccountNotice,
}));

const { __internal, notifySocialAccount } = await import("./notify");

describe("account notice retry loop", () => {
  beforeEach(() => {
    attempts.length = 0;
    loggerCalls = [];
    outcomes = [];
    sendSocialAccountNotice.mockClear();
  });

  const params = {
    accountName: "hello@example.com",
    action: "linked" as const,
    changedAt: "2026-10-18T12:00:00.000Z",
    provider: "google" as const,
  };

  test("stops after the first success", async () => {
    outcomes = [{ success: true }];

    await __internal.withRetry(
      "social-account",
      "user@example.com",
      () => sendSocialAccountNotice(),
      { attempts: 3 }
    );

    expect(attempts).toHaveLength(1);
    expect(loggerCalls.some((c) => c.msg === "account notice sent")).toBe(true);
  });

  test("retries a transient failure and then succeeds", async () => {
    outcomes = [{ error: "rate limited", success: false }, { success: true }];

    const result = await __internal.withRetry(
      "social-account",
      "user@example.com",
      () => sendSocialAccountNotice(),
      { attempts: 3 }
    );

    expect(attempts).toHaveLength(2);
    expect(result.success).toBe(true);
  });

  test("gives up after the attempt budget and reports an error", async () => {
    outcomes = [
      { error: "boom", success: false },
      { error: "boom", success: false },
      { error: "boom", success: false },
    ];

    const result = await __internal.withRetry(
      "social-account",
      "user@example.com",
      () => sendSocialAccountNotice(),
      { attempts: 3 }
    );

    expect(attempts).toHaveLength(3);
    expect(result.success).toBe(false);
    expect(
      loggerCalls.some((c) => c.msg === "account notice dropped after retries")
    ).toBe(true);
  });

  test("a throwing sender is caught, not propagated", async () => {
    const result = await __internal.withRetry(
      "social-account",
      "user@example.com",
      () => {
        throw new Error("network down");
      },
      { attempts: 1 }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("network down");
  });

  test("redacts the local part of the recipient in log context", () => {
    expect(__internal.redactEmail("user@example.com")).toBe("u***@example.com");
    expect(__internal.redactEmail("a@b.co")).toBe("a***@b.co");
  });

  test("fire-and-forget dispatch resolves without awaiting delivery", () => {
    outcomes = [{ success: true }];

    // Returns void synchronously; the send happens on the microtask queue.
    const returned = notifySocialAccount("user@example.com", params);
    expect(returned).toBeUndefined();
  });
});
