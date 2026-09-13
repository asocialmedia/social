import { beforeEach, describe, expect, mock, test } from "bun:test";

const published = mock((_channel: string, _message: string) => 1);

class FakeIoRedis {
  status = "ready";
  publish: typeof published = published;
  connect = mock(() => this);
  on = mock((_event: string, _listener: () => void) => this);
  quit = mock(() => "OK");
  subscribe = mock(() => 1);
  unsubscribe = mock(() => 1);
}

mock.module("ioredis", () => ({ default: FakeIoRedis }));

const {
  parseSessionRevocationEvent,
  publishSessionRevocation,
  sessionEventChannel,
} = await import("@asm/db");

describe("session revocation events", () => {
  beforeEach(() => {
    published.mockClear();
  });

  test("publishes an account-scoped event without session tokens", async () => {
    await publishSessionRevocation("user-1", {
      revokedSessionId: "session-2",
    });

    expect(published).toHaveBeenCalledWith(
      "session-events:user-1",
      '{"kind":"session.revoked","revokedSessionId":"session-2"}'
    );
    expect(sessionEventChannel("user-1")).toBe("session-events:user-1");
  });

  test("rejects ambiguous or malformed events", () => {
    expect(parseSessionRevocationEvent("invalid")).toBeNull();
    expect(
      parseSessionRevocationEvent(
        '{"kind":"session.revoked","retainedSessionId":"s1","revokedSessionId":"s2"}'
      )
    ).toBeNull();
  });
});
