import type { AuthContext } from "@asm/auth/core";
import {
  extractTokenFromHeader,
  hybridSessionStore,
  validateJWTToken,
} from "@asm/auth/core";
import { prisma } from "@asm/db";
import type { NextRequest } from "next/server";
import { auth } from "./config";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ahh
export async function getSessionFromRequest(
  req: Request | NextRequest
): Promise<AuthContext> {
  try {
    const authHeader = req.headers.get("authorization");
    const token = extractTokenFromHeader(authHeader);

    if (token) {
      const cachedSession = await hybridSessionStore.findByToken(token);
      if (cachedSession) {
        console.log("Using cached session from hybrid store");
        const userData = await prisma.user.findUnique({
          where: { id: cachedSession.userId },
          select: {
            username: true,
            email: true,
            emailVerified: true,
            name: true,
            displayName: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        if (userData) {
          return {
            session: {
              id: cachedSession.id,
              userId: cachedSession.userId,
              token: cachedSession.token,
              expiresAt: cachedSession.expiresAt,
              ipAddress: cachedSession.ipAddress,
              userAgent: cachedSession.userAgent,
              createdAt: cachedSession.createdAt,
              updatedAt: cachedSession.updatedAt,
            },
            user: {
              id: cachedSession.userId,
              email: userData.email || "",
              emailVerified: userData.emailVerified,
              name: userData.name || userData.displayName,
              username: userData.username,
              createdAt: userData.createdAt,
              updatedAt: userData.updatedAt,
            },
          };
        }
      }

      const validationResult = await validateJWTToken(token);
      if (validationResult.valid && validationResult.payload) {
        const userId = validationResult.payload.sub;
        if (!userId) {
          return { session: null, user: null };
        }

        const userData = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            username: true,
            email: true,
            emailVerified: true,
            name: true,
            displayName: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        if (userData) {
          const hybridSession = await hybridSessionStore.create({
            userId,
            token,
            expiresAt: new Date((validationResult.payload.exp || 0) * 1000),
            ipAddress:
              (req.headers.get("x-forwarded-for") as string) ||
              (req.headers.get("x-real-ip") as string),
            userAgent: req.headers.get("user-agent") as string,
          });

          console.log(
            `Created new session ${hybridSession.id} in hybrid store`
          );

          return {
            session: {
              id: hybridSession.id,
              userId: hybridSession.userId,
              token: hybridSession.token,
              expiresAt: hybridSession.expiresAt,
              ipAddress: hybridSession.ipAddress,
              userAgent: hybridSession.userAgent,
              createdAt: hybridSession.createdAt,
              updatedAt: hybridSession.updatedAt,
            },
            user: {
              id: hybridSession.userId,
              email: userData.email || "",
              emailVerified: userData.emailVerified,
              name: userData.name || userData.displayName,
              username: userData.username,
              createdAt: userData.createdAt,
              updatedAt: userData.updatedAt,
            },
          };
        }
      }
    }

    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session) {
      return { session: null, user: null };
    }

    const userData = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { username: true },
    });

    return {
      session: session.session,
      user: {
        ...session.user,
        username: userData?.username || "",
      },
    };
  } catch (error) {
    console.error("Error getting session:", error);
    return { session: null, user: null };
  }
}

export async function requireAuth(req: Request | NextRequest): Promise<{
  session: AuthContext["session"];
  user: AuthContext["user"];
}> {
  const { session, user } = await getSessionFromRequest(req);
  if (!(session && user)) {
    throw new Error("Unauthorized");
  }
  return { session, user };
}

export function optionalAuth(req: Request | NextRequest): Promise<AuthContext> {
  return getSessionFromRequest(req);
}
