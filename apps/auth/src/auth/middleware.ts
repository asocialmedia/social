import type { AuthContext } from "@asm/auth/core";
import {
  extractTokenFromHeader,
  hybridSessionStore,
  validateJWTToken,
} from "@asm/auth/core";
import { prisma } from "@asm/db";

import { auth } from "./config";

interface UserBanState {
  banExpires: Date | null;
  banned: boolean;
  banReason: string | null;
}

function selectUserData() {
  return {
    banExpires: true,
    banReason: true,
    banned: true,
    createdAt: true,
    displayName: true,
    email: true,
    emailVerified: true,
    name: true,
    role: true,
    updatedAt: true,
    username: true,
  } as const;
}

/**
 * Mirror the Better Auth databaseHooks.session.create.before ban check for
 * the hybrid/JWT session paths, which bypass that hook. Returns the user's
 * real ban state; clears expired bans and returns null when the account is
 * actively banned so a banned user cannot keep an authenticated session.
 */
async function enforceBan(
  userId: string,
  userData: UserBanState & {
    username: string;
    email: string | null;
    emailVerified: boolean;
    name: string | null;
    displayName: string | null;
    role: string | null;
    createdAt: Date;
    updatedAt: Date;
  }
): Promise<AuthContext | null> {
  if (userData.banned) {
    const now = new Date();
    const isExpired = userData.banExpires && userData.banExpires <= now;

    if (isExpired) {
      await prisma.user.update({
        data: { banExpires: null, banReason: null, banned: false },
        where: { id: userId },
      });
    } else {
      return { session: null, user: null };
    }
  }

  return null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ahh
export async function getSessionFromRequest(
  req: Request
): Promise<AuthContext> {
  try {
    const authHeader = req.headers.get("authorization");
    const token = extractTokenFromHeader(authHeader);

    if (token) {
      const cachedSession = await hybridSessionStore.findByToken(token);
      if (cachedSession) {
        console.log("Using cached session from hybrid store");
        const userData = await prisma.user.findUnique({
          select: selectUserData(),
          where: { id: cachedSession.userId },
        });

        if (userData) {
          const banned = await enforceBan(cachedSession.userId, userData);
          if (banned) {
            return banned;
          }

          return {
            session: {
              createdAt: cachedSession.createdAt,
              expiresAt: cachedSession.expiresAt,
              id: cachedSession.id,
              ipAddress: cachedSession.ipAddress,
              token: cachedSession.token,
              updatedAt: cachedSession.updatedAt,
              userAgent: cachedSession.userAgent,
              userId: cachedSession.userId,
            },
            user: {
              banExpires: userData.banExpires,
              banReason: userData.banReason,
              banned: userData.banned,
              createdAt: userData.createdAt,
              email: userData.email || "",
              emailVerified: userData.emailVerified,
              id: cachedSession.userId,
              name: userData.name || userData.displayName,
              role: userData.role,
              updatedAt: userData.updatedAt,
              username: userData.username,
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
          select: selectUserData(),
          where: { id: userId },
        });

        if (userData) {
          const banned = await enforceBan(userId, userData);
          if (banned) {
            return banned;
          }

          const hybridSession = await hybridSessionStore.create({
            expiresAt: new Date((validationResult.payload.exp || 0) * 1000),
            ipAddress:
              (req.headers.get("x-forwarded-for") as string) ||
              (req.headers.get("x-real-ip") as string),
            token,
            userAgent: req.headers.get("user-agent") as string,
            userId,
          });

          console.log(
            `Created new session ${hybridSession.id} in hybrid store`
          );

          return {
            session: {
              createdAt: hybridSession.createdAt,
              expiresAt: hybridSession.expiresAt,
              id: hybridSession.id,
              ipAddress: hybridSession.ipAddress,
              token: hybridSession.token,
              updatedAt: hybridSession.updatedAt,
              userAgent: hybridSession.userAgent,
              userId: hybridSession.userId,
            },
            user: {
              banExpires: userData.banExpires,
              banReason: userData.banReason,
              banned: userData.banned,
              createdAt: userData.createdAt,
              email: userData.email || "",
              emailVerified: userData.emailVerified,
              id: hybridSession.userId,
              name: userData.name || userData.displayName,
              role: userData.role,
              updatedAt: userData.updatedAt,
              username: userData.username,
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
      select: { username: true },
      where: { id: session.user.id },
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

export async function requireAuth(req: Request): Promise<{
  session: AuthContext["session"];
  user: AuthContext["user"];
}> {
  const { session, user } = await getSessionFromRequest(req);
  if (!(session && user)) {
    throw new Error("Unauthorized");
  }
  return { session, user };
}

export function optionalAuth(req: Request): Promise<AuthContext> {
  return getSessionFromRequest(req);
}
