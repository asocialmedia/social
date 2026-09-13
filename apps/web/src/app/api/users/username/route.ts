import {
  getUsernameAliasExpiry,
  getUsernameChangeWindowStart,
  isReservedUsername,
  Prisma,
  prisma,
  USERNAME_CHANGE_LIMIT,
} from "@asm/db";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";

const usernameSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores"
    ),
});

type UsernameChangeResult =
  | { aliasExpiresAt: Date; status: "changed"; username: string }
  | { status: "not-found" }
  | { retryAfter: Date; status: "rate-limited" }
  | { status: "taken" }
  | { status: "unchanged"; username: string };

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function isUniqueConflict(error: unknown): boolean {
  return isPrismaError(error, "P2002");
}

function isSerializationConflict(error: unknown): boolean {
  return isPrismaError(error, "P2034");
}

async function changeUsername(
  userId: string,
  requestedUsername: string
): Promise<UsernameChangeResult> {
  const attemptChange = async (
    retriesRemaining: number
  ): Promise<UsernameChangeResult> => {
    try {
      const result = await prisma.$transaction(
        async (transaction): Promise<UsernameChangeResult> => {
          const now = new Date();
          const currentUser = await transaction.user.findUnique({
            select: { id: true, username: true },
            where: { id: userId },
          });
          if (!currentUser) {
            return { status: "not-found" };
          }

          if (
            currentUser.username.toLowerCase() ===
            requestedUsername.toLowerCase()
          ) {
            await transaction.user.update({
              data: { username: requestedUsername },
              where: { id: userId },
            });
            return { status: "unchanged", username: requestedUsername };
          }

          // Treat expired aliases as released even if the daily maintenance job
          // has not reached them yet.
          await transaction.usernameAlias.deleteMany({
            where: {
              expiresAt: { lte: now },
              username: {
                equals: requestedUsername,
                mode: "insensitive",
              },
            },
          });

          const [existingUser, existingAlias, recentChanges] =
            await Promise.all([
              transaction.user.findFirst({
                select: { id: true },
                where: {
                  username: {
                    equals: requestedUsername,
                    mode: "insensitive",
                  },
                },
              }),
              transaction.usernameAlias.findFirst({
                select: { id: true, userId: true },
                where: {
                  expiresAt: { gt: now },
                  username: {
                    equals: requestedUsername,
                    mode: "insensitive",
                  },
                },
              }),
              transaction.usernameAlias.findMany({
                orderBy: { createdAt: "asc" },
                select: { createdAt: true },
                take: USERNAME_CHANGE_LIMIT,
                where: {
                  createdAt: { gte: getUsernameChangeWindowStart(now) },
                  userId,
                },
              }),
            ]);

          if (
            existingUser ||
            (existingAlias && existingAlias.userId !== userId)
          ) {
            return { status: "taken" };
          }
          if (recentChanges.length >= USERNAME_CHANGE_LIMIT) {
            const [oldestChange] = recentChanges;
            if (!oldestChange) {
              throw new Error("Username change limit has no matching history");
            }
            return {
              retryAfter: getUsernameAliasExpiry(oldestChange.createdAt),
              status: "rate-limited",
            };
          }

          // Reclaiming one of your own still-reserved handles replaces that
          // alias with a reservation for the handle you are leaving now.
          if (existingAlias) {
            await transaction.usernameAlias.delete({
              where: { id: existingAlias.id },
            });
          }

          const aliasExpiresAt = getUsernameAliasExpiry(now);
          await transaction.user.update({
            data: { username: requestedUsername },
            where: { id: userId },
          });
          await transaction.usernameAlias.create({
            data: {
              expiresAt: aliasExpiresAt,
              userId,
              username: currentUser.username,
            },
          });

          return {
            aliasExpiresAt,
            status: "changed",
            username: requestedUsername,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      return result;
    } catch (error) {
      if (isSerializationConflict(error) && retriesRemaining > 0) {
        return await attemptChange(retriesRemaining - 1);
      }
      throw error;
    }
  };

  return await attemptChange(2);
}

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ username: session.user.username });
}

export async function PATCH(request: Request) {
  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = usernameSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid username" },
        { status: 400 }
      );
    }
    const { username } = parsed.data;
    if (isReservedUsername(username)) {
      return Response.json(
        { error: "That username is reserved" },
        { status: 400 }
      );
    }

    const result = await changeUsername(user.id, username);
    if (result.status === "not-found") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (result.status === "taken") {
      return Response.json(
        { error: "Username is already taken" },
        { status: 400 }
      );
    }
    if (result.status === "rate-limited") {
      return Response.json(
        {
          error: "You can change your username up to 5 times every 30 days.",
          retryAfter: result.retryAfter.toISOString(),
        },
        { status: 429 }
      );
    }

    return Response.json({
      aliasExpiresAt:
        result.status === "changed"
          ? result.aliasExpiresAt.toISOString()
          : null,
      changed: result.status === "changed",
      success: true,
      username: result.username,
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      return Response.json(
        { error: "Username is already taken" },
        { status: 400 }
      );
    }
    console.error("Failed to update username:", error);
    return Response.json(
      { error: "Failed to update username" },
      { status: 500 }
    );
  }
}
