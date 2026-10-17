import { describe, expect, test } from "bun:test";

import { decryptMessage, encryptMessage } from "./crypto";
import {
  CHAT_DAY_MS,
  canSendIncognitoDraft,
  deriveIncognitoRootKey,
  incognitoIsActive,
  incognitoNotice,
  incognitoTimeRemaining,
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
  test("the whole session expires at the deadline, regardless of reads", () => {
    const start = Date.parse(session.startedAt);
    expect(incognitoIsActive(session, start + CHAT_DAY_MS - 1)).toBe(true);
    expect(incognitoIsActive(session, start + CHAT_DAY_MS)).toBe(false);
    expect(
      incognitoIsActive({ ...session, endedAt: session.startedAt }, start + 1)
    ).toBe(false);
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
    expect(
      incognitoTimeRemaining(session.expiresAt, Date.parse(session.expiresAt))
    ).toBe("Ending…");
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
