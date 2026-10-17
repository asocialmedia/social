import { describe, expect, test } from "bun:test";

import { decryptMessage, encryptMessage } from "./crypto";
import {
  CHAT_DAY_MS,
  canSendIncognitoDraft,
  deriveIncognitoRootKey,
  incognitoIsActive,
  incognitoNotice,
  incognitoMessageExpiresAt,
  incognitoUsageDuration,
  validCiphertext,
} from "./lifecycle";
import type { IncognitoSession } from "./lifecycle";

const session: IncognitoSession = {
  conversationId: "dm",
  endReason: null,
  endedAt: null,
  endedById: null,
  endedByName: null,
  expiresAt: "2026-10-17T10:00:00.000Z",
  id: crypto.randomUUID(),
  nextSequence: 0,
  startedAt: "2026-10-16T10:00:00.000Z",
  startedById: "alex",
  startedByName: "Alex",
};
describe("incognito session contract", () => {
  test("usage duration stays compact and only describes completed sessions", () => {
    const endedAfter = (milliseconds: number) => ({
      ...session,
      endedAt: new Date(
        Date.parse(session.startedAt) + milliseconds
      ).toISOString(),
    });
    expect(incognitoUsageDuration(session)).toBeNull();
    expect(incognitoUsageDuration(endedAfter(0))).toBe("<1m");
    expect(incognitoUsageDuration(endedAfter(59_999))).toBe("<1m");
    expect(incognitoUsageDuration(endedAfter(60_000))).toBe("1m");
    expect(incognitoUsageDuration(endedAfter(59 * 60_000))).toBe("59m");
    expect(incognitoUsageDuration(endedAfter(60 * 60_000))).toBe("1h");
    expect(incognitoUsageDuration(endedAfter(75 * 60_000))).toBe("1h 15m");
    expect(incognitoUsageDuration(endedAfter(2 * CHAT_DAY_MS))).toBe("48h");
    expect(incognitoUsageDuration(endedAfter(-1))).toBeNull();
    expect(
      incognitoUsageDuration({ ...session, endedAt: "invalid" })
    ).toBeNull();
    expect(
      incognitoUsageDuration({
        endedAt: session.startedAt,
        startedAt: "invalid",
      })
    ).toBeNull();
  });
  test("sessions remain active until explicitly ended", () => {
    expect(incognitoIsActive({ ...session, expiresAt: null })).toBe(true);
    expect(incognitoIsActive(session)).toBe(true);
    expect(incognitoIsActive({ ...session, endedAt: session.startedAt })).toBe(
      false
    );
  });
  test("each message receives its own 24-hour lifetime", () => {
    const first = { createdAt: session.startedAt };
    const later = {
      createdAt: new Date(Date.parse(session.startedAt) + 60_000).toISOString(),
    };
    expect(incognitoMessageExpiresAt(first)).toBe(
      Date.parse(first.createdAt) + CHAT_DAY_MS
    );
    expect(
      incognitoMessageExpiresAt(later) - incognitoMessageExpiresAt(first)
    ).toBe(60_000);
  });
  test("usage notice contains actors and lifecycle only", () => {
    expect(
      incognitoNotice({
        ...session,
        endReason: "timeout",
        endedAt: session.expiresAt,
      })
    ).toContain("Ended automatically after 24 hours");
    expect(
      incognitoNotice({
        ...session,
        endReason: "manual",
        endedAt: session.expiresAt,
        endedByName: "Sam",
      })
    ).toContain("Ended by Sam");
  });
  test("session keys are separated from normal messages and other sessions", async () => {
    const root = crypto.getRandomValues(new Uint8Array(32));
    const first = await deriveIncognitoRootKey(root, session.id);
    const second = await deriveIncognitoRootKey(root, crypto.randomUUID());
    expect(first).not.toEqual(root);
    expect(first).not.toEqual(second);
    expect(first).toEqual(await deriveIncognitoRootKey(root, session.id));
    const encrypted = await encryptMessage(first, "alex", 0, session.id, {
      content: "temporary",
      type: "text",
    });
    expect(validCiphertext(encrypted.ciphertext)).toBe(true);
    expect(await decryptMessage(first, "alex", session.id, encrypted)).toEqual({
      content: "temporary",
      type: "text",
    });
    await expect(
      decryptMessage(second, "alex", session.id, encrypted)
    ).rejects.toThrow();
  });
});

test("incognito accepts text without attachments and waits for staged uploads", () => {
  expect(canSendIncognitoDraft("hello", 0, false)).toBe(true);
  expect(canSendIncognitoDraft("  ", 0, false)).toBe(false);
  expect(canSendIncognitoDraft("hello", 1, false)).toBe(false);
  expect(canSendIncognitoDraft("", 1, true)).toBe(true);
});
