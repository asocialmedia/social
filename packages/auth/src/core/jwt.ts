import { type CachedSession, jwtSessionCache } from "@asm/db";
import { type JWTPayload, jwtVerify } from "jose";

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
      issuer: process.env.NEXT_PUBLIC_URL || "https://social.localhost",
      audience: process.env.NEXT_PUBLIC_URL || "https://social.localhost",
    });

    return { valid: true, payload };
  } catch (error) {
    console.error("JWT validation failed:", error);
    return {
      valid: false,
      error:
        error instanceof Error ? error.message : "Unknown validation error",
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
      id: String(
        payload.jti || payload.sid || `session_${userId}_${Date.now()}`
      ),
      createdAt: new Date(payload.iat ? payload.iat * 1000 : Date.now()),
      updatedAt: new Date(),
      userId,
      expiresAt: new Date((payload.exp || 0) * 1000),
      token,
      ipAddress: payload.ip as string,
      userAgent: payload.ua as string,
    },
    user: {
      id: userId,
      email: payload.email as string,
      emailVerified: payload.email_verified as boolean,
      name: (payload.name as string) || "",
      username:
        userData?.username ||
        (payload.username as string) ||
        (payload.preferred_username as string) ||
        "",
      createdAt: new Date(payload.iat ? payload.iat * 1000 : Date.now()),
      updatedAt: new Date(),
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
