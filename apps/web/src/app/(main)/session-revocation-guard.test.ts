import { describe, expect, test } from "bun:test";

import {
  parseSessionRevocationEvent,
  shouldEndSession,
} from "./session-revocation-guard";

describe("session revocation events", () => {
  test("ends only the session named by a single-session revoke", () => {
    const event = parseSessionRevocationEvent(
      '{"kind":"session.revoked","revokedSessionId":"session-1"}'
    );
    expect(event).not.toBeNull();
    if (!event) {
      return;
    }
    expect(shouldEndSession(event, "session-1")).toBe(true);
    expect(shouldEndSession(event, "session-2")).toBe(false);
  });

  test("keeps only the acting session after ending other devices", () => {
    const event = parseSessionRevocationEvent(
      '{"kind":"session.revoked","retainedSessionId":"session-1"}'
    );
    expect(event).not.toBeNull();
    if (!event) {
      return;
    }
    expect(shouldEndSession(event, "session-1")).toBe(false);
    expect(shouldEndSession(event, "session-2")).toBe(true);
  });

  test("rejects malformed event payloads", () => {
    expect(parseSessionRevocationEvent("not-json")).toBeNull();
    expect(parseSessionRevocationEvent('{"kind":"other"}')).toBeNull();
    expect(
      parseSessionRevocationEvent(
        '{"kind":"session.revoked","retainedSessionId":7}'
      )
    ).toBeNull();
  });
});
