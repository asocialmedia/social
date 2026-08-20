import {
  BADGES,
  BadgeLimitError,
  grantBadge,
  prisma,
  revokeBadge,
  userCache,
} from "@asm/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { adminProcedure, router, t } from "../../trpc";
import type { User } from "../../types";

// Hard rule: the app runs with exactly one admin. Granting a second admin is
// rejected, and the last remaining admin cannot be demoted (otherwise nobody
// could ever promote anyone again and the app would be locked out).
async function assertRoleChangeAllowed(userId: string, newRole: string) {
  if (newRole === "admin") {
    const otherAdmins = await prisma.user.count({
      where: { id: { not: userId }, role: "admin" },
    });
    if (otherAdmins > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Only one admin is allowed for the app. Demote the current admin before promoting someone else.",
      });
    }
    return;
  }

  const current = await prisma.user.findUnique({
    select: { role: true },
    where: { id: userId },
  });
  if (current?.role === "admin") {
    const otherAdmins = await prisma.user.count({
      where: { id: { not: userId }, role: "admin" },
    });
    if (otherAdmins === 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The app needs exactly one admin, so the last admin cannot be demoted.",
      });
    }
  }
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
  const where: Record<string, unknown> = {};

  if (filters?.role) {
    where.role = filters.role;
  }

  if (filters?.emailVerified !== undefined) {
    where.emailVerified = filters.emailVerified;
  }

  if (filters?.hasEmail !== undefined) {
    where.email = filters.hasEmail ? { not: null } : null;
  }

  let searchResults: string[] | null = null;
  if (filters?.search?.trim()) {
    const matchingUsers = await prisma.user.findMany({
      select: { id: true },
      take: 1000,
      where: {
        OR: [
          { username: { contains: filters.search, mode: "insensitive" } },
          { displayName: { contains: filters.search, mode: "insensitive" } },
          {
            displayUsername: { contains: filters.search, mode: "insensitive" },
          },
          { email: { contains: filters.search, mode: "insensitive" } },
        ],
      },
    });
    searchResults = matchingUsers.map((user) => user.id);

    if (searchResults.length === 0) {
      return {
        hasMore: false,
        nextCursor: undefined,
        totalCount: 0,
        users: [],
      };
    }
    where.id = { in: searchResults };
  }

  const users = await prisma.user.findMany({
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: {
      [sortBy]: sortOrder,
    },
    select: {
      _count: {
        select: {
          bookmarks: true,
          comments: true,
          followers: true,
          following: true,
          posts: true,
          sessions: true,
          vote: true,
        },
      },
      aura: true,
      avatarUrl: true,
      banned: true,
      bio: true,
      createdAt: true,
      displayName: true,
      displayUsername: true,
      email: true,
      emailVerified: true,
      id: true,
      role: true,
      updatedAt: true,
      username: true,
    },
    take: limit + 1,
    where,
  });

  const hasMore = users.length > limit;
  const usersToReturn = hasMore ? users.slice(0, -1) : users;
  const nextCursor = hasMore ? usersToReturn.at(-1)?.id : undefined;
  const totalCount = await prisma.user.count({ where });

  const transformedUsers = usersToReturn.map((user) => ({
    aura: user.aura,
    avatarUrl: user.avatarUrl,
    banned: user.banned ?? false,
    bio: user.bio,
    bookmarks: user._count.bookmarks,
    createdAt: user.createdAt.toISOString(),
    displayName: user.displayName,
    displayUsername: user.displayUsername,
    email: user.email,
    emailVerified: user.emailVerified,
    followers: user._count.followers,
    following: user._count.following,
    id: user.id,
    joinedDate: user.createdAt.toISOString(),
    posts: user._count.posts,
    role: user.role as "user" | "admin",
    sessions: user._count.sessions,
    updatedAt: user.updatedAt.toISOString(),
    username: user.username,
  }));

  return {
    hasMore,
    nextCursor,
    totalCount,
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

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          data: { banExpires, banReason: input.banReason, banned: true },
          where: { id: input.userId },
        });
        await tx.session.deleteMany({ where: { userId: input.userId } });
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
      const where = userIds ? { id: { in: userIds } } : {};
      const users = await prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          _count: {
            select: {
              bookmarks: true,
              comments: true,
              followers: true,
              following: true,
              posts: true,
              vote: true,
            },
          },
          aura: true,
          bio: true,
          createdAt: true,
          displayName: true,
          displayUsername: true,
          email: true,
          emailVerified: true,
          id: true,
          role: true,
          updatedAt: true,
          username: true,
          ...(includeSessions && {
            sessions: {
              orderBy: { createdAt: "desc" },
              select: {
                createdAt: true,
                expiresAt: true,
                id: true,
                ipAddress: true,
                userAgent: true,
              },
              take: 5,
            },
          }),
        },
        take: userIds ? undefined : 1000,
        where,
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

        const csvRows = users.map((user) => [
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
        data: users,
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
            // would break the "exactly one admin" invariant.
            if (data.role === "admin") {
              if (userIds.length > 1) {
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "Only one admin is allowed for the app.",
                });
              }
              await assertRoleChangeAllowed(userIds[0], data.role);
            }

            result = await prisma.user.updateMany({
              data: { role: data.role },
              where: { id: { in: userIds } },
            });
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

            result = await prisma.user.updateMany({
              data: {
                emailVerified: data.emailVerified,
                emailVerifiedAt: data.emailVerified ? new Date() : null,
              },
              where: { id: { in: userIds } },
            });
            break;
          }

          case "deleteUsers": {
            // Soft delete by setting a deleted flag, or hard delete
            // For now, we'll do a soft delete by setting role to null or similar
            // In a real app, you might want to add a deletedAt field
            result = await prisma.user.deleteMany({
              where: { id: { in: userIds } },
            });
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

      const [
        totalUsers,
        newUsers,
        activeUsers,
        verifiedUsers,
        totalPosts,
        totalAura,
        oauthBreakdown,
        topUsersByAura,
        userActivityByHour,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({
          where: { createdAt: { gte: startDate } },
        }),
        prisma.user.count({
          where: {
            sessions: {
              some: {
                createdAt: { gte: startDate },
              },
            },
          },
        }),
        prisma.user.count({
          where: { emailVerified: true },
        }),
        prisma.post.count(),
        prisma.user.aggregate({
          _sum: { aura: true },
        }),

        prisma.$queryRaw<{ provider: string; count: number }[]>`
          SELECT
            CASE
              WHEN google_id IS NOT NULL THEN 'google'
              WHEN reddit_id IS NOT NULL THEN 'reddit'
              ELSE 'email'
            END as provider,
            COUNT(*) as count
          FROM users
          GROUP BY provider
          ORDER BY count DESC
        `,

        prisma.user.findMany({
          orderBy: { aura: "desc" },
          select: {
            aura: true,
            displayName: true,
            id: true,
            username: true,
          },
          take: 10,
        }),

        prisma.$queryRaw<{ hour: number; count: number }[]>`
          SELECT
            EXTRACT(HOUR FROM created_at) as hour,
            COUNT(*) as count
          FROM sessions
          WHERE created_at >= ${startDate}
          GROUP BY EXTRACT(HOUR FROM created_at)
          ORDER BY hour
        `,
      ]);

      const analytics = {
        oauthBreakdown: oauthBreakdown as { provider: string; count: number }[],
        overview: {
          activeUsers,
          newUsers,
          totalAura: totalAura._sum.aura || 0,
          totalPosts,
          totalUsers,
          verificationRate:
            totalUsers > 0 ? Math.round((verifiedUsers / totalUsers) * 100) : 0,
          verifiedUsers,
        },
        topUsersByAura,
        userActivityByHour: userActivityByHour as {
          hour: number;
          count: number;
        }[],
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

      const trends = await prisma.$queryRaw<{ date: string; count: number }[]>`
        SELECT
          DATE(created_at) as date,
          COUNT(*) as count
        FROM users
        WHERE created_at >= ${startDate}
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at)
      `;

      return trends;
    }),

  getStats: rateLimitedAdminProcedure.query(async () => {
    const cachedStats = await userCache.getUserStats();
    if (cachedStats) {
      return cachedStats;
    }

    const [
      totalUsers,
      adminUsers,
      verifiedUsers,
      recentUsers,
      totalPosts,
      totalAura,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: "admin" } }),
      prisma.user.count({ where: { emailVerified: true } }),
      prisma.user.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      }),
      prisma.post.count(),
      prisma.user.aggregate({
        _sum: {
          aura: true,
        },
      }),
    ]);

    const stats = {
      adminUsers,
      recentUsers,
      totalAura: totalAura._sum.aura || 0,
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

      const user = await prisma.user.findUnique({
        include: {
          _count: {
            select: {
              bookmarks: true,
              comments: true,
              followers: true,
              following: true,
              posts: true,
              vote: true,
            },
          },
          accounts: {
            select: {
              createdAt: true,
              providerId: true,
            },
          },
          sessions: {
            orderBy: { createdAt: "desc" },
            select: {
              createdAt: true,
              expiresAt: true,
              id: true,
              ipAddress: true,
              userAgent: true,
            },
            take: 5,
          },
        },
        where: { id: userId },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

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
        prisma.session.count({
          where: {
            createdAt: { gte: startDate },
            userId,
          },
        }),

        prisma.post.count({
          where: {
            createdAt: { gte: startDate },
            userId,
          },
        }),

        prisma.comment.count({
          where: {
            createdAt: { gte: startDate },
            userId,
          },
        }),

        prisma.auraLog.aggregate({
          _sum: { amount: true },
          where: {
            createdAt: { gte: startDate },
            type: {
              in: [
                "POST_CREATION",
                "POST_VOTE",
                "COMMENT_CREATION",
                "COMMENT_RECEIVED",
                "FOLLOW_GAINED",
                "FOLLOW_GIVEN",
                "POST_BOOKMARKED",
                "POST_BOOKMARK_RECEIVED",
              ],
            },
            userId,
          },
        }),

        prisma.auraLog.aggregate({
          _sum: { amount: true },
          where: {
            createdAt: { gte: startDate },
            issuerId: userId,
            type: { in: ["POST_VOTE_REMOVED"] },
          },
        }),

        prisma.session.findFirst({
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
          where: { userId },
        }),
      ]);

      const activityData = {
        auraGained: auraGained._sum.amount || 0,
        auraSpent: Math.abs(auraSpent._sum.amount || 0),
        commentsCount,
        lastActivity: lastActivity?.createdAt || null,
        postsCount,
        sessionCount,
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
    .query(
      async ({ input }) =>
        await prisma.session.findMany({
          orderBy: { createdAt: "desc" },
          where: { userId: input.userId },
        })
    ),

  removeUser: rateLimitedAdminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.user.delete({ where: { id: input.userId } });
      await userCache.invalidateUserDetail(input.userId);
      await userCache.invalidateUserList();
      await userCache.invalidateUserStats();
      return { success: true };
    }),

  revokeUserSession: rateLimitedAdminProcedure
    .input(z.object({ sessionToken: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await prisma.session.deleteMany({ where: { token: input.sessionToken } });
      await userCache.invalidateUserStats();
      return { success: true };
    }),

  revokeUserSessions: rateLimitedAdminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(async (tx) => {
        await tx.session.deleteMany({ where: { userId: input.userId } });
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
      await assertRoleChangeAllowed(input.userId, input.role);

      try {
        await prisma.user.update({
          data: { role: input.role },
          where: { id: input.userId },
        });

        await userCache.invalidateUserDetail(input.userId);
        await userCache.invalidateUserList();
        await userCache.invalidateUserStats();

        return { success: true };
      } catch (error) {
        console.error("Failed to update user role:", error);
        const trpcError = new TRPCError({
          cause: error,
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update user role",
        });
        throw trpcError;
      }
    }),

  unbanUser: rateLimitedAdminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          data: { banExpires: null, banReason: null, banned: false },
          where: { id: input.userId },
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

      if (data.role) {
        await assertRoleChangeAllowed(userId, data.role);
      }

      const user = await prisma.user.update({
        data,
        select: {
          aura: true,
          avatarUrl: true,
          bio: true,
          createdAt: true,
          displayName: true,
          displayUsername: true,
          email: true,
          emailVerified: true,
          id: true,
          role: true,
          updatedAt: true,
          username: true,
        },
        where: { id: userId },
      });

      await userCache.invalidateUserDetail(userId);
      await userCache.invalidateUserList();
      await userCache.invalidateUserStats();
      await userCache.invalidateSearchCache();
      return user;
    }),
});
