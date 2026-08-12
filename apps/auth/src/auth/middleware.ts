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
    username: true,
    email: true,
    emailVerified: true,
    name: true,
    displayName: true,
    role: true,
    banned: true,
    banReason: true,
    banExpires: true,
    createdAt: true,
    updatedAt: true,
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
        where: { id: userId },
        data: { banned: false, banReason: null, banExpires: null },
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
          where: { id: cachedSession.userId },
          select: selectUserData(),
        });

        if (userData) {
          const banned = await enforceBan(cachedSession.userId, userData);
          if (banned) {
            return banned;
          }

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
              role: userData.role,
              banned: userData.banned,
              banReason: userData.banReason,
              banExpires: userData.banExpires,
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
          select: selectUserData(),
        });

        if (userData) {
          const banned = await enforceBan(userId, userData);
          if (banned) {
            return banned;
          }

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
              role: userData.role,
              banned: userData.banned,
              banReason: userData.banReason,
              banExpires: userData.banExpires,
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
