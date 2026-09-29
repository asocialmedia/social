import { describe, expect, test } from "bun:test";

import {
  buildSessionEventsUrl,
  parseSessionRevocationEvent,
  shouldEndSession,
} from "./session-revocation";

describe("parseSessionRevocationEvent", () => {
  test("parses a valid JSON string with revokedSessionId", () => {
    const raw = JSON.stringify({
      kind: "session.revoked",
      revokedSessionId: "session-1",
    });
    expect(parseSessionRevocationEvent(raw)).toEqual({
      kind: "session.revoked",
      revokedSessionId: "session-1",
    });
  });

  test("parses a valid JSON string with retainedSessionId", () => {
    const raw = JSON.stringify({
      kind: "session.revoked",
      retainedSessionId: "session-1",
    });
    expect(parseSessionRevocationEvent(raw)).toEqual({
      kind: "session.revoked",
      retainedSessionId: "session-1",
    });
  });

  test("parses a valid JSON string with neither id (all sessions)", () => {
    const raw = JSON.stringify({ kind: "session.revoked" });
    expect(parseSessionRevocationEvent(raw)).toEqual({
      kind: "session.revoked",
    });
  });

  test("parses a parsed object directly", () => {
    expect(
      parseSessionRevocationEvent({
        kind: "session.revoked",
        revokedSessionId: "session-abc",
      })
    ).toEqual({
      kind: "session.revoked",
      revokedSessionId: "session-abc",
    });
  });

  test("returns null for malformed JSON string", () => {
    expect(parseSessionRevocationEvent("not-valid-json")).toBeNull();
  });

  test("returns null for null, undefined, numbers, or arrays", () => {
    expect(parseSessionRevocationEvent(null)).toBeNull();
    expect(parseSessionRevocationEvent()).toBeNull();
    expect(parseSessionRevocationEvent(42)).toBeNull();
    expect(parseSessionRevocationEvent([])).toBeNull();
  });

  test("returns null for unexpected kind", () => {
    expect(parseSessionRevocationEvent({ kind: "session.created" })).toBeNull();
  });

  test("returns null when both retainedSessionId and revokedSessionId are provided", () => {
    expect(
      parseSessionRevocationEvent({
        kind: "session.revoked",
        retainedSessionId: "s1",
        revokedSessionId: "s2",
      })
    ).toBeNull();
  });

  test("returns null when session IDs are not strings", () => {
    expect(
      parseSessionRevocationEvent({
        kind: "session.revoked",
        retainedSessionId: 123,
      })
    ).toBeNull();
    expect(
      parseSessionRevocationEvent({
        kind: "session.revoked",
        revokedSessionId: true,
      })
    ).toBeNull();
  });
});

describe("shouldEndSession", () => {
  test("ends session when revokedSessionId matches current session", () => {
    expect(
      shouldEndSession(
        { kind: "session.revoked", revokedSessionId: "sess-1" },
        "sess-1"
      )
    ).toBe(true);
  });

  test("preserves session when revokedSessionId does not match current session", () => {
    expect(
      shouldEndSession(
        { kind: "session.revoked", revokedSessionId: "sess-2" },
        "sess-1"
      )
    ).toBe(false);
  });

  test("preserves session when retainedSessionId matches current session", () => {
    expect(
      shouldEndSession(
        { kind: "session.revoked", retainedSessionId: "sess-1" },
        "sess-1"
      )
    ).toBe(false);
  });

  test("ends session when retainedSessionId does not match current session", () => {
    expect(
      shouldEndSession(
        { kind: "session.revoked", retainedSessionId: "sess-2" },
        "sess-1"
      )
    ).toBe(true);
  });

  test("ends all sessions when neither id is specified", () => {
    expect(shouldEndSession({ kind: "session.revoked" }, "sess-1")).toBe(true);
  });
});

describe("buildSessionEventsUrl", () => {
  test("appends /api/auth/session-events correctly", () => {
    expect(buildSessionEventsUrl("https://asocialmedia.cc")).toBe(
      "https://asocialmedia.cc/api/auth/session-events"
    );
    expect(buildSessionEventsUrl("https://asocialmedia.cc/")).toBe(
      "https://asocialmedia.cc/api/auth/session-events"
    );
    expect(buildSessionEventsUrl("https://asocialmedia.cc///")).toBe(
      "https://asocialmedia.cc/api/auth/session-events"
    );
  });
});
