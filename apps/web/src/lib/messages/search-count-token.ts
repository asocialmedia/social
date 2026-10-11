import { createHmac, timingSafeEqual } from "node:crypto";

const COUNT_TOKEN_VERSION = 1;
const MAX_COUNT_TOKEN_LENGTH = 2048;

export interface MessageSearchCountToken {
  conversationId: string;
  expiresAt: string;
  membershipSequence: number;
  normalizationVersion: number;
  queryHash: string;
  recoveryGeneration: number;
  requestId: string;
  snapshotSequence: number;
  userId: string;
}

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

export function createMessageSearchCountToken(
  token: MessageSearchCountToken,
  secret: string
): string {
  const payload = Buffer.from(
    JSON.stringify({ version: COUNT_TOKEN_VERSION, ...token })
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readMessageSearchCountToken(
  token: string,
  scope: { conversationId: string; userId: string },
  secret: string
): MessageSearchCountToken | null {
  if (token.length === 0 || token.length > MAX_COUNT_TOKEN_LENGTH) {
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
    if (
      !isRecord(parsed) ||
      parsed.version !== COUNT_TOKEN_VERSION ||
      typeof parsed.conversationId !== "string" ||
      typeof parsed.expiresAt !== "string" ||
      !Number.isFinite(new Date(parsed.expiresAt).getTime()) ||
      !isSequence(parsed.membershipSequence) ||
      !isSequence(parsed.normalizationVersion) ||
      typeof parsed.queryHash !== "string" ||
      !isSequence(parsed.recoveryGeneration) ||
      typeof parsed.requestId !== "string" ||
      !isSequence(parsed.snapshotSequence) ||
      typeof parsed.userId !== "string"
    ) {
      return null;
    }
    const value: MessageSearchCountToken = {
      conversationId: parsed.conversationId,
      expiresAt: new Date(parsed.expiresAt).toISOString(),
      membershipSequence: parsed.membershipSequence,
      normalizationVersion: parsed.normalizationVersion,
      queryHash: parsed.queryHash,
      recoveryGeneration: parsed.recoveryGeneration,
      requestId: parsed.requestId,
      snapshotSequence: parsed.snapshotSequence,
      userId: parsed.userId,
    };
    if (
      value.conversationId !== scope.conversationId ||
      value.userId !== scope.userId ||
      new Date(value.expiresAt).getTime() <= Date.now()
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}
