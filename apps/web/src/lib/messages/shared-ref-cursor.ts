import { createHmac, timingSafeEqual } from "node:crypto";

const SHARED_REF_CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 2048;

export interface SharedRefCursor {
  after: { createdAt: string; messageId: string; ordinal: number };
  conversationId: string;
  direction?: "newer" | "older";
  kind: "link" | "media" | "post";
  membershipSequence: number;
  recoveryGeneration: number;
  snapshotSequence: number;
  userId: string;
}

export type SharedRefCursorScope = Omit<
  SharedRefCursor,
  "after" | "snapshotSequence"
>;

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function createSharedRefCursor(
  cursor: SharedRefCursor,
  secret: string
): string {
  const payload = Buffer.from(
    JSON.stringify({
      version: SHARED_REF_CURSOR_VERSION,
      ...cursor,
      direction: cursor.direction ?? "older",
    })
  ).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function readSharedRefCursor(
  token: string,
  expected: SharedRefCursorScope,
  secret: string
): SharedRefCursor | null {
  if (token.length === 0 || token.length > MAX_CURSOR_LENGTH) {
    return null;
  }
  const [payload, providedSignature, extra] = token.split(".");
  if (!payload || !providedSignature || extra !== undefined) {
    return null;
  }
  const expectedSignature = Buffer.from(signature(payload, secret));
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
    if (!isRecord(parsed) || !isRecord(parsed.after)) {
      return null;
    }
    const { after } = parsed;
    const direction = parsed.direction ?? "older";
    if (
      parsed.version !== SHARED_REF_CURSOR_VERSION ||
      typeof after.createdAt !== "string" ||
      typeof after.messageId !== "string" ||
      !Number.isSafeInteger(after.ordinal) ||
      typeof after.ordinal !== "number" ||
      after.ordinal < 0 ||
      (direction !== "older" && direction !== "newer") ||
      typeof parsed.conversationId !== "string" ||
      typeof parsed.kind !== "string" ||
      !["link", "media", "post"].includes(parsed.kind) ||
      !isSequence(parsed.membershipSequence) ||
      !isSequence(parsed.recoveryGeneration) ||
      !isSequence(parsed.snapshotSequence) ||
      typeof parsed.userId !== "string"
    ) {
      return null;
    }
    const cursor: SharedRefCursor = {
      after: {
        createdAt: after.createdAt,
        messageId: after.messageId,
        ordinal: after.ordinal,
      },
      conversationId: parsed.conversationId,
      direction,
      kind: parsed.kind as SharedRefCursor["kind"],
      membershipSequence: parsed.membershipSequence,
      recoveryGeneration: parsed.recoveryGeneration,
      snapshotSequence: parsed.snapshotSequence,
      userId: parsed.userId,
    };
    if (
      cursor.conversationId !== expected.conversationId ||
      cursor.kind !== expected.kind ||
      cursor.membershipSequence !== expected.membershipSequence ||
      cursor.recoveryGeneration !== expected.recoveryGeneration ||
      cursor.userId !== expected.userId ||
      !Number.isFinite(new Date(cursor.after.createdAt).getTime())
    ) {
      return null;
    }
    return cursor;
  } catch {
    return null;
  }
}
