import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_VERSION = 1;
const MAX_TOKEN_LENGTH = 1024;

export interface GlobalMessageSearchSessionToken {
  expiresAt: number;
  queryHash: string;
  sessionId: string;
  userId: string;
  version: number;
}

export interface GlobalMessageSearchCursor {
  conversationId: string;
  createdAt: string;
  messageId: string;
  sessionId: string;
  userId: string;
  version: number;
}

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function createGlobalMessageSearchSessionToken(
  session: Omit<GlobalMessageSearchSessionToken, "version">,
  secret: string
): string {
  const payload = Buffer.from(
    JSON.stringify({ version: SESSION_VERSION, ...session })
  ).toString("base64url");
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}

export function readGlobalMessageSearchSessionToken(
  token: string,
  expected: { queryHash: string; userId: string },
  secret: string,
  now = Date.now()
): GlobalMessageSearchSessionToken | null {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) {
    return null;
  }
  const expectedSignature = sign(payload, secret);
  const providedSignature = Buffer.from(signature, "base64url");
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf-8")
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const value = parsed as Record<string, unknown>;
    if (
      value.version !== SESSION_VERSION ||
      !Number.isSafeInteger(value.expiresAt) ||
      typeof value.sessionId !== "string" ||
      !/^[a-f0-9-]{36}$/u.test(value.sessionId) ||
      value.userId !== expected.userId ||
      value.queryHash !== expected.queryHash ||
      (value.expiresAt as number) <= now
    ) {
      return null;
    }
    return {
      expiresAt: value.expiresAt as number,
      queryHash: expected.queryHash,
      sessionId: value.sessionId,
      userId: expected.userId,
      version: SESSION_VERSION,
    };
  } catch {
    return null;
  }
}

export function createGlobalMessageSearchCursor(
  cursor: Omit<GlobalMessageSearchCursor, "version">,
  secret: string
): string {
  const payload = Buffer.from(
    JSON.stringify({ version: SESSION_VERSION, ...cursor })
  ).toString("base64url");
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}

export function readGlobalMessageSearchCursor(
  token: string,
  expected: { sessionId: string; userId: string },
  secret: string
): GlobalMessageSearchCursor | null {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) {
    return null;
  }
  const expectedSignature = sign(payload, secret);
  const providedSignature = Buffer.from(signature, "base64url");
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf-8")
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const value = parsed as Record<string, unknown>;
    if (
      value.version !== SESSION_VERSION ||
      value.sessionId !== expected.sessionId ||
      value.userId !== expected.userId ||
      typeof value.conversationId !== "string" ||
      value.conversationId.length === 0 ||
      typeof value.messageId !== "string" ||
      value.messageId.length === 0 ||
      typeof value.createdAt !== "string" ||
      Number.isNaN(Date.parse(value.createdAt))
    ) {
      return null;
    }
    return {
      conversationId: value.conversationId,
      createdAt: value.createdAt,
      messageId: value.messageId,
      sessionId: expected.sessionId,
      userId: expected.userId,
      version: SESSION_VERSION,
    };
  } catch {
    return null;
  }
}
