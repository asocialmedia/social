import { createHmac, timingSafeEqual } from "node:crypto";

const MESSAGE_CHANGE_CURSOR_VERSION = 1;
const MESSAGE_CHANGE_CURSOR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MESSAGE_CHANGE_CURSOR_LENGTH = 2048;

export interface MessageChangeCursor {
  afterSequence: number;
  conversationId: string;
  issuedAt: number;
  membershipSequence: number;
  recoveryGeneration: number;
  snapshotSequence: number;
  userId: string;
}

export type MessageChangeCursorScope = Omit<
  MessageChangeCursor,
  "afterSequence" | "issuedAt" | "snapshotSequence"
>;

export type MessageChangeCursorResult =
  | { status: "invalid" }
  | { cursor: MessageChangeCursor; status: "valid" }
  | { status: "scope-changed" }
  | { status: "expired" };

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
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function createMessageChangeCursor(
  input: Omit<MessageChangeCursor, "issuedAt">,
  secret: string,
  now = Date.now()
): string {
  const payload = Buffer.from(
    JSON.stringify({
      version: MESSAGE_CHANGE_CURSOR_VERSION,
      ...input,
      issuedAt: now,
    })
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readMessageChangeCursor(
  token: string,
  expected: MessageChangeCursorScope,
  secret: string,
  now = Date.now()
): MessageChangeCursorResult {
  if (token.length === 0 || token.length > MAX_MESSAGE_CHANGE_CURSOR_LENGTH) {
    return { status: "invalid" };
  }
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) {
    return { status: "invalid" };
  }
  const expectedSignature = Buffer.from(sign(payload, secret));
  const providedSignature = Buffer.from(signature);
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return { status: "invalid" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
  } catch {
    return { status: "invalid" };
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== MESSAGE_CHANGE_CURSOR_VERSION ||
    !isSequence(parsed.afterSequence) ||
    !isSequence(parsed.issuedAt) ||
    !isSequence(parsed.membershipSequence) ||
    !isSequence(parsed.recoveryGeneration) ||
    !isSequence(parsed.snapshotSequence) ||
    typeof parsed.conversationId !== "string" ||
    typeof parsed.userId !== "string" ||
    parsed.afterSequence > parsed.snapshotSequence
  ) {
    return { status: "invalid" };
  }

  const cursor: MessageChangeCursor = {
    afterSequence: parsed.afterSequence,
    conversationId: parsed.conversationId,
    issuedAt: parsed.issuedAt,
    membershipSequence: parsed.membershipSequence,
    recoveryGeneration: parsed.recoveryGeneration,
    snapshotSequence: parsed.snapshotSequence,
    userId: parsed.userId,
  };
  if (
    cursor.issuedAt > now + 60_000 ||
    now - cursor.issuedAt > MESSAGE_CHANGE_CURSOR_TTL_MS
  ) {
    return { status: "expired" };
  }
  if (
    cursor.conversationId !== expected.conversationId ||
    cursor.membershipSequence !== expected.membershipSequence ||
    cursor.recoveryGeneration !== expected.recoveryGeneration ||
    cursor.userId !== expected.userId
  ) {
    return { status: "scope-changed" };
  }
  return { cursor, status: "valid" };
}
