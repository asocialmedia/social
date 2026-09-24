import {
  and,
  BADGES,
  BadgeLimitError,
  fromPrismaDateTime,
  grantBadge,
  prisma,
  revokeBadge,
  toPrismaDateTime,
  userCache,
} from "@asm/db";
import type { PrismaOrm, PrismaTransaction } from "@asm/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { adminProcedure, router, t } from "../../trpc";
import type { User } from "../../types";

type UsersCollection = PrismaOrm["public"]["Users"];

interface SessionExportRow {
  createdAt: unknown;
  expiresAt: unknown;
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
}

function isSessionExportRows(value: unknown): value is SessionExportRow[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "id" in entry &&
        typeof entry.id === "string"
    )
  );
}

class ConcurrentRoleChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrentRoleChangeError";
  }
}

async function changeRole(
  userId: string,
  newRole: "admin" | "user",
  users: UsersCollection = prisma.orm.public.Users
): Promise<boolean> {
  const current = await users.select("role").where({ id: userId }).first();
  if (current?.role === newRole) {
    return false;
  }

  const otherAdmins = await users
    .where((user) => and(user.id.neq(userId), user.role.eq("admin")))
    .aggregate((aggregate) => ({ count: aggregate.count() }));

  if (!current) {
    if (newRole === "admin" && otherAdmins.count > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Only one admin is allowed for the app. Demote the current admin before promoting someone else.",
      });
    }
    return false;
  }

  if (newRole === "admin" && otherAdmins.count > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Only one admin is allowed for the app. Demote the current admin before promoting someone else.",
    });
  }
  if (
    newRole === "user" &&
    current.role === "admin" &&
    otherAdmins.count === 0
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The app needs exactly one admin, so the last admin cannot be demoted.",
    });
  }

  const claimed = await users
    .where((user) => and(user.id.eq(userId), user.role.eq(current.role)))
    .updateAndCount({ role: newRole });
  if (claimed !== 1) {
    throw new ConcurrentRoleChangeError("user role changed");
  }
  return true;
}

async function runAtomicRoleChange<T>(
  fn: (tx: PrismaTransaction) => Promise<T>,
  attemptsRemaining = 4
): Promise<T> {
  try {
    return await prisma.transaction(fn);
  } catch (error) {
    const isConflict =
      error instanceof ConcurrentRoleChangeError ||
      (error instanceof Error &&
        "sqlState" in error &&
        (error.sqlState === "23505" ||
          error.sqlState === "40001" ||
          error.sqlState === "40P01")) ||
      (error instanceof Error && error.message.includes("could not serialize"));
    if (!isConflict || attemptsRemaining <= 1) {
      throw error;
    }
    return await runAtomicRoleChange(fn, attemptsRemaining - 1);
  }
}

interface OAuthAccountGroup {
  count: number;
  googleId: string | null;
  redditId: string | null;
}

function buildOauthBreakdown(groups: OAuthAccountGroup[]) {
  const providerCounts = new Map<string, number>();
  for (const group of groups) {
    let provider = "email";
    if (group.googleId) {
      provider = "google";
    } else if (group.redditId) {
      provider = "reddit";
    }
    providerCounts.set(
      provider,
      (providerCounts.get(provider) ?? 0) + group.count
    );
  }
  return [...providerCounts.entries()]
    .map(([provider, count]) => ({ count, provider }))
    .toSorted((left, right) => right.count - left.count);
}

type PrismaDateTime = Parameters<typeof fromPrismaDateTime>[0];

function buildUserActivityByHour(createdAtValues: PrismaDateTime[]) {
  const hourCounts = new Map<number, number>();
  for (const createdAt of createdAtValues) {
    const hour = fromPrismaDateTime(createdAt).getHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }
  return [...hourCounts.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([hour, count]) => ({ count, hour }));
}

function buildRegistrationTrends(createdAtValues: PrismaDateTime[]) {
  const dateCounts = new Map<string, number>();
  for (const createdAt of createdAtValues) {
    const date = fromPrismaDateTime(createdAt).toISOString().slice(0, 10);
    dateCounts.set(date, (dateCounts.get(date) ?? 0) + 1);
  }
  return [...dateCounts.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([date, count]) => ({ count, date }));
}

const rateLimitedAdminProcedure = adminProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user?.id) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "User not authenticated",
    });
  }

  const rateLimitResult = await userCache.checkRateLimit(ctx.user.id);

  if (!rateLimitResult.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Rate limit exceeded. Try again in ${rateLimitResult.resetTime - Math.floor(Date.now() / 1000)} seconds.`,
    });
  }

  return next();
});

// Prisma 8 surfaces unique constraint conflicts as SQLSTATE 23505. A partial unique index
// on users(role) where role='admin' makes the "exactly one admin" rule atomic
// at the database level, so concurrent promotions cannot race past the
// check-then-write in assertRoleChangeAllowed.
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Error && "sqlState" in error && error.sqlState === "23505"
  );
}

function adminLimitConflict(): TRPCError {
  return new TRPCError({
    code: "CONFLICT",
    message: "Only one admin is allowed for the app.",
  });
}

// Converts a DB unique-constraint conflict (single-admin race) into the
// user-facing CONFLICT response; rethrows TRPCError untouched; wraps everything
// else as INTERNAL_SERVER_ERROR.
function rethrowRoleError(error: unknown): never {
  if (error instanceof TRPCError) {
    throw error;
  }
  if (isUniqueConstraintViolation(error)) {
    throw adminLimitConflict();
  }
  console.error("Role update failed:", error);
  throw new TRPCError({
    cause: error,
    code: "INTERNAL_SERVER_ERROR",
    message: "Failed to update role",
  });
}

export interface AdminUser {
  _count: {
    posts: number;
    followers: number;
    following: number;
    bookmarks: number;
    comments: number;
    vote: number;
    sessions: number;
  };
  aura: number;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: Date;
  displayName: string;
  displayUsername: string | null;
  email: string | null;
  emailVerified: boolean;
  id: string;
  role: string;
  updatedAt: Date;
  username: string;
}

export interface UserListFilters {
  emailVerified?: boolean;
  hasEmail?: boolean;
  role?: "user" | "admin";
  search?: string;
  sortBy?: "createdAt" | "aura" | "username" | "displayName";
  sortOrder?: "asc" | "desc";
}

export interface UserListResult {
  hasMore: boolean;
  nextCursor?: string;
  totalCount: number;
  users: User[];
}

async function fetchUsersFromDatabase(input: {
  limit: number;
  cursor?: string;
  filters?: {
    role?: "user" | "admin";
    emailVerified?: boolean;
    hasEmail?: boolean;
    search?: string;
  };
  sortBy: "createdAt" | "aura" | "username" | "displayName";
  sortOrder: "asc" | "desc";
}): Promise<UserListResult> {
  const { limit, cursor, filters, sortBy, sortOrder } = input;
  const role = filters?.role;
  const emailVerified = filters?.emailVerified;
  const hasEmail = filters?.hasEmail;
  let searchResults: string[] | null = null;
  if (filters?.search?.trim()) {
    const search = filters.search.trim();
    const pattern = `%${search}%`;
    const matchingUsers = await Promise.all([
      prisma.orm.public.Users.select("id")
        .where((user) => user.username.ilike(pattern))
        .limit(1000)
        .all(),
      prisma.orm.public.Users.select("id")
        .where((user) => user.displayName.ilike(pattern))
        .limit(1000)
        .all(),
      prisma.orm.public.Users.select("id")
        .where((user) => user.displayUsername.ilike(pattern))
        .limit(1000)
        .all(),
      prisma.orm.public.Users.select("id")
        .where((user) => user.email.ilike(pattern))
        .limit(1000)
        .all(),
    ]);
    searchResults = [...new Set(matchingUsers.flat().map((user) => user.id))];

    if (searchResults.length === 0) {
      return {
        hasMore: false,
        nextCursor: undefined,
        totalCount: 0,
        users: [],
      };
    }
  }

  let userQuery = prisma.orm.public.Users.select(
    "aura",
    "avatarUrl",
    "banned",
    "bio",
    "createdAt",
    "displayName",
    "displayUsername",
    "email",
    "emailVerified",
    "id",
    "role",
    "updatedAt",
    "username"
  )
    .include("bookmarks", (bookmarks) => bookmarks.count())
    .include("comments", (comments) => comments.count())
    .include("follows", (follows) => follows.count())
    .include("followsFollows", (followers) => followers.count())
    .include("posts", (posts) => posts.count())
    .include("sessionsSessions", (sessions) => sessions.count())
    .include("votes", (votes) => votes.count())
    .where((user) => {
      const conditions = [];
      if (role) {
        conditions.push(user.role.eq(role));
      }
      if (emailVerified !== undefined) {
        conditions.push(user.emailVerified.eq(emailVerified));
      }
      if (hasEmail !== undefined) {
        conditions.push(
          hasEmail ? user.email.isNotNull() : user.email.isNull()
        );
      }
      if (searchResults) {
        conditions.push(user.id.in(searchResults));
      }
      return and(...conditions);
    })
    .orderBy([
      (user) => {
        if (sortBy === "aura") {
          return sortOrder === "asc" ? user.aura.asc() : user.aura.desc();
        }
        if (sortBy === "username") {
          return sortOrder === "asc"
            ? user.username.asc()
            : user.username.desc();
        }
        if (sortBy === "displayName") {
          return sortOrder === "asc"
            ? user.displayName.asc()
            : user.displayName.desc();
        }
        return sortOrder === "asc"
          ? user.createdAt.asc()
          : user.createdAt.desc();
      },
      (user) => (sortOrder === "asc" ? user.id.asc() : user.id.desc()),
    ])
    .limit(limit + 1);
  if (cursor) {
    userQuery = userQuery.cursor({ id: cursor });
  }
  const users = await userQuery.all();

  const hasMore = users.length > limit;
  const usersToReturn = hasMore ? users.slice(0, -1) : users;
  const nextCursor = hasMore ? usersToReturn.at(-1)?.id : undefined;
  const totalCount = await prisma.orm.public.Users.where((user) => {
    const conditions = [];
    if (role) {
      conditions.push(user.role.eq(role));
    }
    if (emailVerified !== undefined) {
      conditions.push(user.emailVerified.eq(emailVerified));
    }
    if (hasEmail !== undefined) {
      conditions.push(hasEmail ? user.email.isNotNull() : user.email.isNull());
    }
    if (searchResults) {
      conditions.push(user.id.in(searchResults));
    }
    return and(...conditions);
  }).aggregate((aggregate) => ({ count: aggregate.count() }));

  const transformedUsers = usersToReturn.map((user) => {
    const createdAt = fromPrismaDateTime(user.createdAt);
    const updatedAt = fromPrismaDateTime(user.updatedAt);
    return {
      aura: user.aura,
      avatarUrl: user.avatarUrl,
      banned: user.banned ?? false,
      bio: user.bio,
      bookmarks: user.bookmarks,
      createdAt: createdAt.toISOString(),
      displayName: user.displayName,
      displayUsername: user.displayUsername,
      email: user.email,
      emailVerified: user.emailVerified,
      followers: user.followsFollows,
      following: user.follows,
      id: user.id,
      joinedDate: createdAt.toISOString(),
      posts: user.posts,
      role: user.role as "user" | "admin",
      sessions: user.sessionsSessions,
      updatedAt: updatedAt.toISOString(),
      username: user.username,
    };
  });

  return {
    hasMore,
    nextCursor,
    totalCount: totalCount.count,
    users: transformedUsers,
  } satisfies UserListResult;
}

const timingMiddleware = t.middleware(async ({ next, path }) => {
  const startTime = Date.now();
  // eslint-disable-next-line callback-return -- tRPC next() returns a promise, not a node callback
  const result = await next();
  const duration = Date.now() - startTime;
  console.log(`[API Timing] ${path}: ${duration}ms`);
  return result;
});

const timedAdminProcedure = rateLimitedAdminProcedure.use(timingMiddleware);

export const adminRouter = router({
  banUser: rateLimitedAdminProcedure
    .input(
      z.object({
        banExpiresIn: z.number().int().positive().optional(),
        banReason: z.string().min(1),
        userId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const banExpires = input.banExpiresIn
        ? new Date(Date.now() + input.banExpiresIn * 1000)
        : null;

      await prisma.transaction(async (tx) => {
        await tx.orm.public.Users.where({ id: input.userId }).update({
          banExpires: banExpires ? toPrismaDateTime(banExpires) : null,
          banReason: input.banReason,
          banned: true,
        });
        await tx.orm.public.Sessions.where({
          userId: input.userId,
        }).deleteAndCount();
      });

      await userCache.invalidateUserDetail(input.userId);
      await userCache.invalidateUserList();
      return { success: true };
    }),

  bulkExportUsers: rateLimitedAdminProcedure
    .input(
      z.object({
        format: z.enum(["json", "csv"]).default("json"),
        includeSessions: z.boolean().default(false),
        userIds: z.array(z.string()).max(1000).optional(),
      })
    )
    .query(async ({ input }) => {
      const { userIds, format, includeSessions } = input;
      const baseQuery = prisma.orm.public.Users.select(
        "aura",
        "bio",
        "createdAt",
        "displayName",
        "displayUsername",
        "email",
        "emailVerified",
        "id",
        "role",
        "updatedAt",
        "username"
      )
        .include("bookmarks", (bookmarks) => bookmarks.count())
        .include("comments", (comments) => comments.count())
        .include("follows", (follows) => follows.count())
        .include("followsFollows", (followers) => followers.count())
        .include("posts", (posts) => posts.count())
        .include("votes", (votes) => votes.count())
        .where((user) => (userIds ? user.id.in(userIds) : and()))
        .orderBy((user) => user.createdAt.desc());
      const boundedQuery = userIds ? baseQuery : baseQuery.limit(1000);
      const users = includeSessions
        ? await boundedQuery
            .include("sessionsSessions", (sessions) =>
              sessions
                .select(
                  "createdAt",
                  "expiresAt",
                  "id",
                  "ipAddress",
                  "userAgent"
                )
                .orderBy((session) => session.createdAt.desc())
                .limit(5)
            )
            .all()
        : await boundedQuery.all();
      const normalizedUsers = users.map((user) => {
        const sessionRows =
          "sessionsSessions" in user &&
          isSessionExportRows(user.sessionsSessions)
            ? user.sessionsSessions
            : [];
        return {
          ...user,
          _count: {
            bookmarks: user.bookmarks,
            comments: user.comments,
            followers: user.followsFollows,
            following: user.follows,
            posts: user.posts,
            vote: user.votes,
          },
          createdAt: fromPrismaDateTime(user.createdAt),
          sessions: sessionRows.map((session) => ({
            ...session,
            createdAt: fromPrismaDateTime(session.createdAt),
            expiresAt: fromPrismaDateTime(session.expiresAt),
          })),
          updatedAt: fromPrismaDateTime(user.updatedAt),
        };
      });

      if (format === "csv") {
        const headers = [
          "ID",
          "Username",
          "Display Name",
          "Email",
          "Email Verified",
          "Role",
          "Aura",
          "Posts",
          "Followers",
          "Following",
          "Bookmarks",
          "Comments",
          "Votes",
          "Created At",
          "Updated At",
          "Bio",
        ];

        const csvRows = normalizedUsers.map((user) => [
          user.id,
          user.username,
          user.displayName,
          user.email || "",
          user.emailVerified.toString(),
          user.role,
          user.aura.toString(),
          user._count.posts.toString(),
          user._count.followers.toString(),
          user._count.following.toString(),
          user._count.bookmarks.toString(),
          user._count.comments.toString(),
          user._count.vote.toString(),
          user.createdAt.toISOString(),
          user.updatedAt.toISOString(),
          user.bio || "",
        ]);

        return {
          count: users.length,
          data: [headers, ...csvRows],
          format: "csv",
        };
      }

      return {
        count: users.length,
        data: normalizedUsers,
        format: "json",
      };
    }),

  bulkUpdateUsers: rateLimitedAdminProcedure
    .input(
      z.object({
        action: z.enum([
          "updateRole",
          "updateEmailVerification",
          "deleteUsers",
        ]),
        data: z.union([
          z.object({
            role: z.enum(["user", "admin"]),
          }),
          z.object({
            emailVerified: z.boolean(),
          }),
          z.object({}),
        ]),
        userIds: z.array(z.string()).min(1).max(100),
      })
    )
    .mutation(async ({ input }) => {
      const { userIds, action, data } = input;

      if (userIds.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No users selected",
        });
      }

      if (userIds.length > 100) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot process more than 100 users at once",
        });
      }

      try {
        let result: { count: number };

        switch (action) {
          case "updateRole": {
            if (!("role" in data)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Role data is required for updateRole action",
              });
            }

            // The single-admin rule applies to bulk grants too: promoting more
            // than one user at once, or promoting while another admin exists,
            // would break the "exactly one admin" invariant. Demoting every
            // current admin at once would lock the app out of admin access.
            result = {
              count: await runAtomicRoleChange(async (tx) => {
                if (data.role === "admin") {
                  if (userIds.length > 1) {
                    throw new TRPCError({
                      code: "CONFLICT",
                      message: "Only one admin is allowed for the app.",
                    });
                  }
                  await changeRole(userIds[0], data.role, tx.orm.public.Users);
                } else {
                  const currentAdmins = await tx.orm.public.Users.select("id")
                    .where({ role: "admin" })
                    .all();
                  const selectedAdminIds = currentAdmins.filter((admin) =>
                    userIds.includes(admin.id)
                  );
                  if (
                    currentAdmins.length > 0 &&
                    selectedAdminIds.length === currentAdmins.length
                  ) {
                    throw new TRPCError({
                      code: "CONFLICT",
                      message:
                        "The app needs exactly one admin, so the last admin cannot be demoted.",
                    });
                  }
                  let roleUpdates: Promise<unknown> = Promise.resolve();
                  for (const admin of selectedAdminIds) {
                    roleUpdates = roleUpdates.then(() =>
                      changeRole(admin.id, data.role, tx.orm.public.Users)
                    );
                  }
                  await roleUpdates;
                }

                return tx.orm.public.Users.where((user) =>
                  user.id.in(userIds)
                ).updateAndCount({ role: data.role });
              }),
            };
            break;
          }

          case "updateEmailVerification": {
            if (!("emailVerified" in data)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "Email verification data is required for updateEmailVerification action",
              });
            }

            result = {
              count: await prisma.orm.public.Users.where((user) =>
                user.id.in(userIds)
              ).updateAndCount({
                emailVerified: data.emailVerified,
                emailVerifiedAt: data.emailVerified
                  ? toPrismaDateTime(new Date())
                  : null,
              }),
            };
            break;
          }

          case "deleteUsers": {
            // Soft delete by setting a deleted flag, or hard delete
            // For now, we'll do a soft delete by setting role to null or similar
            // In a real app, you might want to add a deletedAt field
            result = {
              count: await prisma.orm.public.Users.where((user) =>
                user.id.in(userIds)
              ).deleteAndCount(),
            };
            break;
          }

          default: {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Invalid action",
            });
          }
        }

        await userCache.invalidateSearchCache();
        await userCache.invalidateUserList();
        await userCache.invalidateUserStats();
        await Promise.all(
          userIds.map((userId) => userCache.invalidateUserDetail(userId))
        );

        return {
          action,
          affectedCount: result.count,
          message: `Successfully ${action} for ${result.count} user(s)`,
          success: true,
        };
      } catch (error) {
        // Preserve CONFLICT responses from the single-admin validation and the
        // DB constraint; only wrap unexpected errors as INTERNAL_SERVER_ERROR.
        if (error instanceof TRPCError) {
          throw error;
        }
        if (isUniqueConstraintViolation(error)) {
          throw adminLimitConflict();
        }
        console.error("Bulk operation error:", error);
        const trpcError = new TRPCError({
          cause: error,
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to perform bulk operation",
        });
        throw trpcError;
      }
    }),

  getAnalytics: rateLimitedAdminProcedure
    .input(
      z.object({
        timeframe: z.enum(["7d", "30d", "90d", "1y"]).default("30d"),
      })
    )
    .query(async ({ input }) => {
      const { timeframe } = input;
      const cachedAnalytics = await userCache.getAnalytics(timeframe);
      if (cachedAnalytics) {
        return cachedAnalytics;
      }

      const timeframeDays = { "1y": 365, "30d": 30, "7d": 7, "90d": 90 };
      const days = timeframeDays[timeframe];
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const startDateValue = toPrismaDateTime(startDate);
      const [
        totalUsersResult,
        newUsersResult,
        activeUsersResult,
        verifiedUsersResult,
        totalPostsResult,
        totalAuraResult,
        oauthAccountGroups,
        topUsersByAura,
        sessionCreatedAt,
      ] = await Promise.all([
        prisma.orm.public.Users.aggregate((aggregate) => ({
          count: aggregate.count(),
        })),
        prisma.orm.public.Users.where((user) =>
          user.createdAt.gte(startDateValue)
        ).aggregate((aggregate) => ({ count: aggregate.count() })),
        prisma.orm.public.Users.where((user) =>
          user.sessionsSessions.some((session) =>
            session.createdAt.gte(startDateValue)
          )
        ).aggregate((aggregate) => ({ count: aggregate.count() })),
        prisma.orm.public.Users.where({ emailVerified: true }).aggregate(
          (aggregate) => ({ count: aggregate.count() })
        ),
        prisma.orm.public.Posts.aggregate((aggregate) => ({
          count: aggregate.count(),
        })),
        prisma.orm.public.Users.aggregate((aggregate) => ({
          aura: aggregate.sum("aura"),
        })),
        prisma.orm.public.Users.groupBy("googleId", "redditId").aggregate(
          (aggregate) => ({ count: aggregate.count() })
        ),
        prisma.orm.public.Users.select("aura", "displayName", "id", "username")
          .orderBy((user) => user.aura.desc())
          .limit(10)
          .all(),
        prisma.orm.public.Sessions.select("createdAt")
          .where((session) => session.createdAt.gte(startDateValue))
          .all(),
      ]);
      const totalUsers = totalUsersResult.count;
      const newUsers = newUsersResult.count;
      const activeUsers = activeUsersResult.count;
      const verifiedUsers = verifiedUsersResult.count;
      const totalPosts = totalPostsResult.count;
      const totalAura = totalAuraResult.aura ?? 0;
      const oauthBreakdown = buildOauthBreakdown(oauthAccountGroups);
      const userActivityByHour = buildUserActivityByHour(
        sessionCreatedAt.map((session) => session.createdAt)
      );

      const analytics = {
        oauthBreakdown,
        overview: {
          activeUsers,
          newUsers,
          totalAura,
          totalPosts,
          totalUsers,
          verificationRate:
            totalUsers > 0 ? Math.round((verifiedUsers / totalUsers) * 100) : 0,
          verifiedUsers,
        },
        topUsersByAura,
        userActivityByHour,
      };

      await userCache.setAnalytics(timeframe, analytics);
      return analytics;
    }),

  getRateLimitStatus: rateLimitedAdminProcedure.query(async ({ ctx }) => {
    if (!ctx.user?.id) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
      });
    }

    return await userCache.getRateLimitStatus(ctx.user.id);
  }),

  getRegistrationTrends: rateLimitedAdminProcedure
    .input(
      z.object({
        days: z.number().min(1).max(365).default(30),
      })
    )
    .query(async ({ input }) => {
      const { days } = input;
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const createdAtValues = await prisma.orm.public.Users.select("createdAt")
        .where((user) => user.createdAt.gte(toPrismaDateTime(startDate)))
        .all();

      return buildRegistrationTrends(
        createdAtValues.map((user) => user.createdAt)
      );
    }),

  getStats: rateLimitedAdminProcedure.query(async () => {
    const cachedStats = await userCache.getUserStats();
    if (cachedStats) {
      return cachedStats;
    }

    const recentDate = toPrismaDateTime(
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    );
    const [
      totalUsersResult,
      adminUsersResult,
      verifiedUsersResult,
      recentUsersResult,
      totalPostsResult,
      totalAuraResult,
    ] = await Promise.all([
      prisma.orm.public.Users.aggregate((aggregate) => ({
        count: aggregate.count(),
      })),
      prisma.orm.public.Users.where({ role: "admin" }).aggregate(
        (aggregate) => ({ count: aggregate.count() })
      ),
      prisma.orm.public.Users.where({ emailVerified: true }).aggregate(
        (aggregate) => ({ count: aggregate.count() })
      ),
      prisma.orm.public.Users.where((user) =>
        user.createdAt.gte(recentDate)
      ).aggregate((aggregate) => ({ count: aggregate.count() })),
      prisma.orm.public.Posts.aggregate((aggregate) => ({
        count: aggregate.count(),
      })),
      prisma.orm.public.Users.aggregate((aggregate) => ({
        aura: aggregate.sum("aura"),
      })),
    ]);
    const totalUsers = totalUsersResult.count;
    const adminUsers = adminUsersResult.count;
    const verifiedUsers = verifiedUsersResult.count;
    const recentUsers = recentUsersResult.count;
    const totalPosts = totalPostsResult.count;

    const stats = {
      adminUsers,
      recentUsers,
      totalAura: totalAuraResult.aura ?? 0,
      totalPosts,
      totalUsers,
      verifiedUsers,
    };

    await userCache.setUserStats(stats);
    return stats;
  }),

  getUser: rateLimitedAdminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      const { userId } = input;
      const cachedUser = await userCache.getUserDetail(userId);
      if (cachedUser) {
        return cachedUser;
      }

      const selectedUser = await prisma.orm.public.Users.where({ id: userId })
        .include("bookmarks", (bookmarks) => bookmarks.count())
        .include("comments", (comments) => comments.count())
        .include("follows", (follows) => follows.count())
        .include("followsFollows", (followers) => followers.count())
        .include("posts", (posts) => posts.count())
        .include("votes", (votes) => votes.count())
        .include("accounts", (accounts) =>
          accounts.select("createdAt", "providerId")
        )
        .include("sessionsSessions", (sessions) =>
          sessions
            .select("createdAt", "expiresAt", "id", "ipAddress", "userAgent")
            .orderBy((session) => session.createdAt.desc())
            .limit(5)
        )
        .first();

      if (!selectedUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      const createdAt = fromPrismaDateTime(selectedUser.createdAt);
      const updatedAt = fromPrismaDateTime(selectedUser.updatedAt);
      const {
        bookmarks,
        comments,
        follows,
        followsFollows,
        posts,
        sessionsSessions,
        votes,
        ...userData
      } = selectedUser;
      const user = {
        ...userData,
        _count: {
          bookmarks,
          comments,
          followers: followsFollows,
          following: follows,
          posts,
          vote: votes,
        },
        accounts: selectedUser.accounts.map((account) => ({
          ...account,
          createdAt: fromPrismaDateTime(account.createdAt),
        })),
        createdAt,
        sessions: sessionsSessions.map((session) => ({
          ...session,
          createdAt: fromPrismaDateTime(session.createdAt),
          expiresAt: fromPrismaDateTime(session.expiresAt),
        })),
        updatedAt,
      };

      await userCache.setUserDetail(userId, user);
      return user;
    }),

  getUserActivity: rateLimitedAdminProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(30),
        userId: z.string(),
      })
    )
    .query(async ({ input }) => {
      const { userId, days } = input;
      const cachedActivity = await userCache.getUserActivity(userId, days);
      if (cachedActivity) {
        return cachedActivity;
      }

      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const [
        sessionCount,
        postsCount,
        commentsCount,
        auraGained,
        auraSpent,
        lastActivity,
      ] = await Promise.all([
        prisma.orm.public.Sessions.where((session) =>
          and(
            session.createdAt.gte(toPrismaDateTime(startDate)),
            session.userId.eq(userId)
          )
        ).aggregate((aggregate) => ({ count: aggregate.count() })),

        prisma.orm.public.Posts.where((post) =>
          and(
            post.createdAt.gte(toPrismaDateTime(startDate)),
            post.userId.eq(userId)
          )
        ).aggregate((aggregate) => ({ count: aggregate.count() })),

        prisma.orm.public.Comments.where((comment) =>
          and(
            comment.createdAt.gte(toPrismaDateTime(startDate)),
            comment.userId.eq(userId)
          )
        ).aggregate((aggregate) => ({ count: aggregate.count() })),

        prisma.orm.public.AuraLogs.where((log) =>
          and(
            log.createdAt.gte(toPrismaDateTime(startDate)),
            log._type.in([
              "POST_CREATION",
              "POST_VOTE",
              "COMMENT_CREATION",
              "COMMENT_RECEIVED",
              "FOLLOW_GAINED",
              "FOLLOW_GIVEN",
              "POST_BOOKMARKED",
              "POST_BOOKMARK_RECEIVED",
            ]),
            log.userId.eq(userId)
          )
        ).aggregate((aggregate) => ({ amount: aggregate.sum("amount") })),

        prisma.orm.public.AuraLogs.where((log) =>
          and(
            log.createdAt.gte(toPrismaDateTime(startDate)),
            log.issuerId.eq(userId),
            log._type.eq("POST_VOTE_REMOVED")
          )
        ).aggregate((aggregate) => ({ amount: aggregate.sum("amount") })),

        prisma.orm.public.Sessions.select("createdAt")
          .where({ userId })
          .orderBy((session) => session.createdAt.desc())
          .first(),
      ]);

      const activityData = {
        auraGained: auraGained.amount ?? 0,
        auraSpent: Math.abs(auraSpent.amount ?? 0),
        commentsCount: commentsCount.count,
        lastActivity: lastActivity
          ? fromPrismaDateTime(lastActivity.createdAt)
          : null,
        postsCount: postsCount.count,
        sessionCount: sessionCount.count,
      };

      await userCache.setUserActivity(userId, days, activityData);
      return activityData;
    }),

  getUsers: timedAdminProcedure
    .input(
      z.object({
        cursor: z.string().optional(),
        filters: z
          .object({
            emailVerified: z.boolean().optional(),
            hasEmail: z.boolean().optional(),
            role: z.enum(["user", "admin"]).optional(),
            search: z.string().optional(),
          })
          .optional(),
        limit: z.number().min(1).max(100).default(20),
        sortBy: z
          .enum(["createdAt", "aura", "username", "displayName"])
          .default("createdAt"),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
      })
    )
    .query(async ({ input }) => {
      const { limit, cursor, filters, sortBy, sortOrder } = input;

      if (filters?.search) {
        const searchCacheKey = userCache.generateSearchCacheKey({
          cursor,
          filters,
          limit,
          searchQuery: filters.search,
          sortBy,
          sortOrder,
        });

        const cachedSearchResult =
          await userCache.getSearchResult(searchCacheKey);
        if (cachedSearchResult) {
          console.log("[Cache] Search cache HIT - returning cached result");
          return cachedSearchResult;
        }

        const result = await fetchUsersFromDatabase(input);
        await userCache.setSearchResult(searchCacheKey, {
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          totalCount: result.totalCount,
          users: result.users,
        });

        return result;
      }

      if (cursor) {
        return await fetchUsersFromDatabase(input);
      }

      const cacheKey = userCache.generateUserListKey(
        filters || {},
        sortBy,
        sortOrder,
        limit
      );
      const cachedResult = await userCache.getUserList(cacheKey);

      if (cachedResult) {
        console.log("[Cache] User list cache HIT - returning cached result");
        return cachedResult;
      }

      const result = await fetchUsersFromDatabase(input);
      await userCache.setUserList(cacheKey, {
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        totalCount: result.totalCount,
        users: result.users,
      });

      return result;
    }),

  listUserSessions: rateLimitedAdminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      const sessions = await prisma.orm.public.Sessions.where({
        userId: input.userId,
      })
        .orderBy((session) => session.createdAt.desc())
        .all();
      return sessions.map((session) => ({
        ...session,
        createdAt: fromPrismaDateTime(session.createdAt),
        expiresAt: fromPrismaDateTime(session.expiresAt),
        updatedAt: fromPrismaDateTime(session.updatedAt),
      }));
    }),

  removeUser: rateLimitedAdminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      const deleted = await prisma.orm.public.Users.where({
        id: input.userId,
      }).delete();
      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }
      await userCache.invalidateUserDetail(input.userId);
      await userCache.invalidateUserList();
      await userCache.invalidateUserStats();
      return { success: true };
    }),

  revokeUserSession: rateLimitedAdminProcedure
    .input(z.object({ sessionToken: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await prisma.orm.public.Sessions.where({
        token: input.sessionToken,
      }).deleteAndCount();
      await userCache.invalidateUserStats();
      return { success: true };
    }),

  revokeUserSessions: rateLimitedAdminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.transaction(async (tx) => {
        await tx.orm.public.Sessions.where({
          userId: input.userId,
        }).deleteAndCount();
      });

      await userCache.invalidateUserStats();
      return { success: true };
    }),

  setBadge: rateLimitedAdminProcedure
    .input(
      z.object({
        badge: z.enum(BADGES),
        grant: z.boolean().default(true),
        userId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const changed = input.grant
          ? await grantBadge(input.userId, input.badge)
          : await revokeBadge(input.userId, input.badge);

        await userCache.invalidateUserDetail(input.userId);
        await userCache.invalidateUserList();
        await userCache.invalidateSearchCache();

        return { changed, success: true };
      } catch (error) {
        if (error instanceof BadgeLimitError) {
          throw new TRPCError({
            code: "CONFLICT",
            message: error.message,
          });
        }
        console.error("Failed to update user badge:", error);
        throw new TRPCError({
          cause: error,
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update user badge",
        });
      }
    }),

  setRole: rateLimitedAdminProcedure
    .input(
      z.object({
        role: z.enum(["user", "admin"]),
        userId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await runAtomicRoleChange(async (tx) => {
          const roleChanged = await changeRole(
            input.userId,
            input.role,
            tx.orm.public.Users
          );
          if (!roleChanged) {
            await tx.orm.public.Users.where({ id: input.userId }).update({
              role: input.role,
            });
          }
        });

        await userCache.invalidateUserDetail(input.userId);
        await userCache.invalidateUserList();
        await userCache.invalidateUserStats();

        return { success: true };
      } catch (error) {
        rethrowRoleError(error);
      }
    }),

  unbanUser: rateLimitedAdminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.transaction(async (tx) => {
        await tx.orm.public.Users.where({ id: input.userId }).update({
          banExpires: null,
          banReason: null,
          banned: false,
        });
      });

      await userCache.invalidateUserDetail(input.userId);
      await userCache.invalidateUserList();
      return { success: true };
    }),

  updateUser: rateLimitedAdminProcedure
    .input(
      z.object({
        data: z.object({
          bio: z.string().optional(),
          displayName: z.string().optional(),
          emailVerified: z.boolean().optional(),
          role: z.enum(["user", "admin"]).optional(),
        }),
        userId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { userId, data } = input;

      // oxlint-disable-next-line unicorn/prefer-ternary -- conditional transaction path is clearer as if/else than a nested ternary
      let user;
      if (data.role) {
        const nextRole = data.role;
        user = await runAtomicRoleChange(async (tx) => {
          await changeRole(userId, nextRole, tx.orm.public.Users);
          return tx.orm.public.Users.select(
            "aura",
            "avatarUrl",
            "bio",
            "createdAt",
            "displayName",
            "displayUsername",
            "email",
            "emailVerified",
            "id",
            "role",
            "updatedAt",
            "username"
          )
            .where({ id: userId })
            .update(data);
        });
      } else {
        user = await prisma.orm.public.Users.select(
          "aura",
          "avatarUrl",
          "bio",
          "createdAt",
          "displayName",
          "displayUsername",
          "email",
          "emailVerified",
          "id",
          "role",
          "updatedAt",
          "username"
        )
          .where({ id: userId })
          .update(data);
      }
      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }
      const updatedUser = {
        ...user,
        createdAt: fromPrismaDateTime(user.createdAt),
        updatedAt: fromPrismaDateTime(user.updatedAt),
      };

      await userCache.invalidateUserDetail(userId);
      await userCache.invalidateUserList();
      await userCache.invalidateUserStats();
      await userCache.invalidateSearchCache();
      return updatedUser;
    }),
});
