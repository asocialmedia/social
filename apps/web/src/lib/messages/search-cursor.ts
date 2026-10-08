import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { MESSAGE_SEARCH_NORMALIZATION_VERSION } from "@asm/messages/search";

const SEARCH_CURSOR_VERSION = 1;
const MAX_SEARCH_CURSOR_LENGTH = 2048;

export interface MessageSearchCursor {
  after: { createdAt: string; messageId: string };
  conversationId: string;
  membershipSequence: number;
  normalizationVersion: number;
  queryHash: string;
  recoveryGeneration: number;
  snapshotSequence: number;
  userId: string;
}

export type MessageSearchCursorScope = Omit<
  MessageSearchCursor,
  "after" | "snapshotSequence"
>;

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function sign(payload: string, secret: string): string {
  return encode(createHmac("sha256", secret).update(payload).digest());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

export function messageSearchQueryHash(normalizedQuery: string): string {
  return createHash("sha256").update(normalizedQuery).digest("base64url");
}

export function createMessageSearchCursor(
  cursor: MessageSearchCursor,
  secret: string
): string {
  const payload = Buffer.from(
    JSON.stringify({ version: SEARCH_CURSOR_VERSION, ...cursor })
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readMessageSearchCursor(
  token: string,
  expected: MessageSearchCursorScope,
  secret: string
): MessageSearchCursor | null {
  if (token.length === 0 || token.length > MAX_SEARCH_CURSOR_LENGTH) {
    return null;
  }
  const [payload, providedSignature, extra] = token.split(".");
  if (!payload || !providedSignature || extra !== undefined) {
    return null;
  }
  const expectedSignature = Buffer.from(sign(payload, secret));
  const provided = Buffer.from(providedSignature);
  if (
    provided.length !== expectedSignature.length ||
    !timingSafeEqual(provided, expectedSignature)
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf-8")
    );
    if (!isRecord(parsed)) {
      return null;
    }
    const value = parsed;
    const { after } = value;
    if (
      value.version !== SEARCH_CURSOR_VERSION ||
      !isRecord(after) ||
      typeof after.createdAt !== "string" ||
      typeof after.messageId !== "string" ||
      !isSequence(value.membershipSequence) ||
      !isSequence(value.normalizationVersion) ||
      typeof value.queryHash !== "string" ||
      !isSequence(value.recoveryGeneration) ||
      !isSequence(value.snapshotSequence) ||
      typeof value.conversationId !== "string" ||
      typeof value.userId !== "string"
    ) {
      return null;
    }
    const cursor: MessageSearchCursor = {
      after: { createdAt: after.createdAt, messageId: after.messageId },
      conversationId: value.conversationId,
      membershipSequence: value.membershipSequence,
      normalizationVersion: value.normalizationVersion,
      queryHash: value.queryHash,
      recoveryGeneration: value.recoveryGeneration,
      snapshotSequence: value.snapshotSequence,
      userId: value.userId,
    };
    if (
      cursor.conversationId !== expected.conversationId ||
      cursor.membershipSequence !== expected.membershipSequence ||
      cursor.normalizationVersion !== MESSAGE_SEARCH_NORMALIZATION_VERSION ||
      cursor.queryHash !== expected.queryHash ||
      cursor.recoveryGeneration !== expected.recoveryGeneration ||
      cursor.userId !== expected.userId
    ) {
      return null;
    }
    const createdAt = new Date(cursor.after.createdAt);
    if (!Number.isFinite(createdAt.getTime())) {
      return null;
    }
    return {
      ...cursor,
      after: { ...cursor.after, createdAt: createdAt.toISOString() },
    };
  } catch {
    return null;
  }
}
