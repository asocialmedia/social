import { jwtSessionCache } from "@asm/db";
import type { CachedSession } from "@asm/db";
import { jwtVerify } from "jose";
import type { JWTPayload } from "jose";

export interface JWTValidationResult {
  error?: string;
  payload?: JWTPayload;
  valid: boolean;
}

export async function validateJWTToken(
  token: string
): Promise<JWTValidationResult> {
  try {
    const secret = new TextEncoder().encode(
      process.env.NEXTAUTH_SECRET || "fallback-secret"
    );

    const { payload } = await jwtVerify(token, secret, {
      audience: process.env.APP_URL || "https://social.localhost",
      issuer: process.env.APP_URL || "https://social.localhost",
    });

    return { payload, valid: true };
  } catch (error) {
    console.error("JWT validation failed:", error);
    return {
      error:
        error instanceof Error ? error.message : "Unknown validation error",
      valid: false,
    };
  }
}

export function extractTokenFromHeader(
  authHeader: string | null
): string | null {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}

export function createJWTValidationCacheKey(token: string): string {
  return jwtSessionCache.createTokenHash(token);
}

export async function cacheJWTValidation(
  token: string,
  payload: JWTPayload,
  userData?: { username?: string }
): Promise<void> {
  const tokenHash = createJWTValidationCacheKey(token);

  const userId = payload.sub;
  if (!userId) {
    throw new Error("JWT payload missing sub claim");
  }

  const sessionData = {
    session: {
      createdAt: new Date(payload.iat ? payload.iat * 1000 : Date.now()),
      expiresAt: new Date((payload.exp || 0) * 1000),
      id: String(
        payload.jti || payload.sid || `session_${userId}_${Date.now()}`
      ),
      ipAddress: payload.ip as string,
      token,
      updatedAt: new Date(),
      userAgent: payload.ua as string,
      userId,
    },
    user: {
      createdAt: new Date(payload.iat ? payload.iat * 1000 : Date.now()),
      email: payload.email as string,
      emailVerified: payload.email_verified as boolean,
      id: userId,
      name: (payload.name as string) || "",
      updatedAt: new Date(),
      username:
        userData?.username ||
        (payload.username as string) ||
        (payload.preferred_username as string) ||
        "",
    },
  };

  await jwtSessionCache.setValidatedSession(tokenHash, sessionData);
}

export function getCachedJWTValidation(
  token: string
): Promise<CachedSession | null> {
  const tokenHash = createJWTValidationCacheKey(token);
  return jwtSessionCache.getValidatedSession(tokenHash);
}

export async function invalidateCachedJWT(token: string): Promise<void> {
  const tokenHash = createJWTValidationCacheKey(token);
  await jwtSessionCache.invalidateSession(tokenHash);
}
