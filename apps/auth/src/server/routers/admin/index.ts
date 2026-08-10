import { TRPCError } from "@trpc/server";
import { debugLog } from "@asm/config/debug";
import { prisma, userCache, userSearchIndex } from "@asm/db";
import { z } from "zod";
import type { User } from "../../../app/types/types";
import { adminProcedure, router, t } from "../../trpc";

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

async function syncUsersWithMeiliSearch(
  userIds: string[],
  action: "updateRole" | "updateEmailVerification" | "deleteUsers"
): Promise<void> {
  if (action === "deleteUsers") {
    for (const userId of userIds) {
      try {
        await userSearchIndex.deleteUser(userId);
      } catch (meiliError) {
        console.warn(
          `Failed to delete user ${userId} from MeiliSearch:`,
          meiliError
        );
      }
    }
  } else {
    const updatedUsers = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        username: true,
        displayName: true,
        displayUsername: true,
        email: true,
        emailVerified: true,
        role: true,
        aura: true,
        createdAt: true,
        updatedAt: true,
        bio: true,
        avatarUrl: true,
      },
    });

    for (const user of updatedUsers) {
      try {
        await userSearchIndex.updateUser({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          displayUsername: user.displayUsername,
          email: user.email,
          role: user.role,
          aura: user.aura,
          emailVerified: user.emailVerified,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
          bio: user.bio,
          avatarUrl: user.avatarUrl,
        });
      } catch (meiliError) {
        console.warn(
          `Failed to update user ${user.id} in MeiliSearch:`,
          meiliError
        );
      }
    }
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ignore
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
    const searchStartTime = Date.now();

    try {
      const meiliResults = await userSearchIndex.search(filters.search.trim(), {
        limit: 1000,
        attributesToRetrieve: ["id"],
      });
      searchResults = meiliResults.hits.map((hit) => hit.id);
    } catch (meiliError) {
      const errorMessage =
        meiliError instanceof Error ? meiliError.message : String(meiliError);
      console.warn(
        `[Search] MeiliSearch failed in ${Date.now() - searchStartTime}ms, falling back to database search:`,
        errorMessage
      );

      where.OR = [
        { username: { contains: filters.search, mode: "insensitive" } },
        { displayName: { contains: filters.search, mode: "insensitive" } },
        { displayUsername: { contains: filters.search, mode: "insensitive" } },
        { email: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    if (searchResults && searchResults.length > 0) {
      where.id = { in: searchResults };
    } else if (searchResults && searchResults.length === 0) {
      console.log("[Search] No results found, returning empty");
      return {
        users: [],
        totalCount: 0,
        hasMore: false,
        nextCursor: undefined,
      };
    }
  } else {
    // No search filter provided
  }

  const users = await prisma.user.findMany({
    where,
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: {
      [sortBy]: sortOrder,
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      displayUsername: true,
      email: true,
      emailVerified: true,
      avatarUrl: true,
      bio: true,
      aura: true,
      role: true,
      banned: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          posts: true,
          followers: true,
          following: true,
          bookmarks: true,
          comments: true,
          vote: true,
          sessions: true,
        },
      },
    },
  });

  const hasMore = users.length > limit;
  const usersToReturn = hasMore ? users.slice(0, -1) : users;
  const nextCursor = hasMore ? usersToReturn.at(-1)?.id : undefined;
  const totalCount = await prisma.user.count({ where });

  const transformedUsers = usersToReturn.map((user) => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    displayUsername: user.displayUsername,
    email: user.email,
    emailVerified: user.emailVerified,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    aura: user.aura,
    role: user.role as "user" | "admin",
    posts: user._count.posts,
    sessions: user._count.sessions,
    following: user._count.following,
    followers: user._count.followers,
    bookmarks: user._count.bookmarks,
    banned: user.banned ?? false,
    joinedDate: user.createdAt.toISOString(),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }));

  return {
    users: transformedUsers,
    totalCount,
    hasMore,
    nextCursor,
  } satisfies UserListResult;
}

const timingMiddleware = t.middleware(async ({ next, path }) => {
  const startTime = Date.now();
  const result = await next();
  const duration = Date.now() - startTime;
  console.log(`[API Timing] ${path}: ${duration}ms`);
  return result;
});

const timedAdminProcedure = rateLimitedAdminProcedure.use(timingMiddleware);

export const adminRouter = router({
  setRole: rateLimitedAdminProcedure
    .input(
      z.object({
        userId: z.string(),
        role: z.enum(["user", "admin"]),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await prisma.user.update({
          where: { id: input.userId },
          data: { role: input.role },
        });

        await syncUsersWithMeiliSearch([input.userId], "updateRole");
        await userCache.invalidateUserDetail(input.userId);
        await userCache.invalidateUserList();
        await userCache.invalidateUserStats();

        return { success: true };
      } catch (error) {
        console.error("Failed to update user role:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update user role",
        });
      }
    }),

  banUser: rateLimitedAdminProcedure
    .input(
      z.object({
        userId: z.string(),
        banReason: z.string().min(1),
        banExpiresIn: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const banExpires = input.banExpiresIn
        ? new Date(Date.now() + input.banExpiresIn * 1000)
        : null;

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: input.userId },
          data: { banned: true, banReason: input.banReason, banExpires },
        });
        await tx.session.deleteMany({ where: { userId: input.userId } });
      });

      await userCache.invalidateUserDetail(input.userId);
      await userCache.invalidateUserList();
      return { success: true };
    }),

  unbanUser: rateLimitedAdminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: input.userId },
          data: { banned: false, banReason: null, banExpires: null },
        });
      });

      await userCache.invalidateUserDetail(input.userId);
      await userCache.invalidateUserList();
      return { success: true };
    }),

  listUserSessions: rateLimitedAdminProcedure
    .input(z.object({ userId: z.string() }))
    .query(
      async ({ input }) =>
        await prisma.session.findMany({
          where: { userId: input.userId },
          orderBy: { createdAt: "desc" },
        })
    ),

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

  removeUser: rateLimitedAdminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.user.delete({ where: { id: input.userId } });
      try {
        await syncUsersWithMeiliSearch([input.userId], "deleteUsers");
      } catch (error) {
        debugLog.api("removeUser:meili-sync-failed", {
          userId: input.userId,
          operation: "deleteUsers",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await userCache.invalidateUserDetail(input.userId);
      await userCache.invalidateUserList();
      await userCache.invalidateUserStats();
      return { success: true };
    }),
  getUsers: timedAdminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
        filters: z
          .object({
            role: z.enum(["user", "admin"]).optional(),
            emailVerified: z.boolean().optional(),
            hasEmail: z.boolean().optional(),
            search: z.string().optional(),
          })
          .optional(),
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
          searchQuery: filters.search,
          filters,
          sortBy,
          sortOrder,
          limit,
          cursor,
        });

        const cachedSearchResult =
          await userCache.getSearchResult(searchCacheKey);
        if (cachedSearchResult) {
          console.log("[Cache] Search cache HIT - returning cached result");
          return cachedSearchResult;
        }

        const result = await fetchUsersFromDatabase(input);
        await userCache.setSearchResult(searchCacheKey, {
          users: result.users,
          totalCount: result.totalCount,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
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
        users: result.users,
        totalCount: result.totalCount,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      });

      return result;
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
        where: { id: userId },
        include: {
          accounts: {
            select: {
              providerId: true,
              createdAt: true,
            },
          },
          sessions: {
            select: {
              id: true,
              createdAt: true,
              expiresAt: true,
              ipAddress: true,
              userAgent: true,
            },
            orderBy: { createdAt: "desc" },
            take: 5,
          },
          _count: {
            select: {
              posts: true,
              followers: true,
              following: true,
              bookmarks: true,
              comments: true,
              vote: true,
            },
          },
        },
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

  updateUser: rateLimitedAdminProcedure
    .input(
      z.object({
        userId: z.string(),
        data: z.object({
          displayName: z.string().optional(),
          bio: z.string().optional(),
          emailVerified: z.boolean().optional(),
          role: z.enum(["user", "admin"]).optional(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const { userId, data } = input;

      const user = await prisma.user.update({
        where: { id: userId },
        data,
        select: {
          id: true,
          username: true,
          displayName: true,
          displayUsername: true,
          email: true,
          emailVerified: true,
          role: true,
          aura: true,
          createdAt: true,
          updatedAt: true,
          bio: true,
          avatarUrl: true,
        },
      });

      try {
        await userSearchIndex.updateUser({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          displayUsername: user.displayUsername,
          email: user.email,
          role: user.role,
          aura: user.aura,
          emailVerified: user.emailVerified,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
          bio: user.bio,
          avatarUrl: user.avatarUrl,
        });
      } catch (meiliError) {
        console.warn("Failed to update user in MeiliSearch:", meiliError);
      }

      await userCache.invalidateUserDetail(userId);
      await userCache.invalidateUserList();
      await userCache.invalidateUserStats();
      await userCache.invalidateSearchCache();
      return user;
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
      totalUsers,
      adminUsers,
      verifiedUsers,
      recentUsers,
      totalPosts,
      totalAura: totalAura._sum.aura || 0,
    };

    await userCache.setUserStats(stats);
    return stats;
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

      const timeframeDays = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
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
              WHEN github_id IS NOT NULL THEN 'github'
              WHEN discord_id IS NOT NULL THEN 'discord'
              WHEN twitter_id IS NOT NULL THEN 'twitter'
              WHEN reddit_id IS NOT NULL THEN 'reddit'
              ELSE 'email'
            END as provider,
            COUNT(*) as count
          FROM users
          GROUP BY provider
          ORDER BY count DESC
        `,

        prisma.user.findMany({
          select: {
            id: true,
            username: true,
            displayName: true,
            aura: true,
          },
          orderBy: { aura: "desc" },
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
        overview: {
          totalUsers,
          newUsers,
          activeUsers,
          verifiedUsers,
          verificationRate:
            totalUsers > 0 ? Math.round((verifiedUsers / totalUsers) * 100) : 0,
          totalPosts,
          totalAura: totalAura._sum.aura || 0,
        },
        oauthBreakdown: oauthBreakdown as { provider: string; count: number }[],
        topUsersByAura,
        userActivityByHour: userActivityByHour as {
          hour: number;
          count: number;
        }[],
      };

      await userCache.setAnalytics(timeframe, analytics);
      return analytics;
    }),

  getUserActivity: rateLimitedAdminProcedure
    .input(
      z.object({
        userId: z.string(),
        days: z.number().min(1).max(90).default(30),
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
            userId,
            createdAt: { gte: startDate },
          },
        }),

        prisma.post.count({
          where: {
            userId,
            createdAt: { gte: startDate },
          },
        }),

        prisma.comment.count({
          where: {
            userId,
            createdAt: { gte: startDate },
          },
        }),

        prisma.auraLog.aggregate({
          where: {
            userId,
            type: {
              in: [
                "POST_CREATION",
                "POST_VOTE",
                "COMMENT_CREATION",
                "FOLLOW_GAINED",
              ],
            },
            createdAt: { gte: startDate },
          },
          _sum: { amount: true },
        }),

        prisma.auraLog.aggregate({
          where: {
            issuerId: userId,
            type: { in: ["POST_VOTE_REMOVED"] },
            createdAt: { gte: startDate },
          },
          _sum: { amount: true },
        }),

        prisma.session.findFirst({
          where: { userId },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);

      const activityData = {
        sessionCount,
        postsCount,
        commentsCount,
        auraGained: auraGained._sum.amount || 0,
        auraSpent: Math.abs(auraSpent._sum.amount || 0),
        lastActivity: lastActivity?.createdAt || null,
      };

      await userCache.setUserActivity(userId, days, activityData);
      return activityData;
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

  bulkUpdateUsers: rateLimitedAdminProcedure
    .input(
      z.object({
        userIds: z.array(z.string()).min(1).max(100),
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
          case "updateRole":
            if (!("role" in data)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Role data is required for updateRole action",
              });
            }

            result = await prisma.user.updateMany({
              where: { id: { in: userIds } },
              data: { role: data.role },
            });
            break;

          case "updateEmailVerification":
            if (!("emailVerified" in data)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "Email verification data is required for updateEmailVerification action",
              });
            }

            result = await prisma.user.updateMany({
              where: { id: { in: userIds } },
              data: {
                emailVerified: data.emailVerified,
                emailVerifiedAt: data.emailVerified ? new Date() : null,
              },
            });
            break;

          case "deleteUsers":
            // Soft delete by setting a deleted flag, or hard delete
            // For now, we'll do a soft delete by setting role to null or similar
            // In a real app, you might want to add a deletedAt field
            result = await prisma.user.deleteMany({
              where: { id: { in: userIds } },
            });
            break;

          default:
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Invalid action",
            });
        }

        await syncUsersWithMeiliSearch(userIds, action);
        await userCache.invalidateSearchCache();
        await userCache.invalidateUserList();
        await userCache.invalidateUserStats();
        for (const userId of userIds) {
          await userCache.invalidateUserDetail(userId);
        }

        return {
          success: true,
          affectedCount: result.count,
          action,
          message: `Successfully ${action} for ${result.count} user(s)`,
        };
      } catch (error) {
        console.error("Bulk operation error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to perform bulk operation",
        });
      }
    }),

  bulkExportUsers: rateLimitedAdminProcedure
    .input(
      z.object({
        userIds: z.array(z.string()).max(1000).optional(),
        format: z.enum(["json", "csv"]).default("json"),
        includeSessions: z.boolean().default(false),
      })
    )
    .query(async ({ input }) => {
      const { userIds, format, includeSessions } = input;
      const where = userIds ? { id: { in: userIds } } : {};
      const users = await prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          displayName: true,
          displayUsername: true,
          email: true,
          emailVerified: true,
          role: true,
          aura: true,
          createdAt: true,
          updatedAt: true,
          bio: true,
          _count: {
            select: {
              posts: true,
              followers: true,
              following: true,
              bookmarks: true,
              comments: true,
              vote: true,
            },
          },
          ...(includeSessions && {
            sessions: {
              select: {
                id: true,
                createdAt: true,
                expiresAt: true,
                ipAddress: true,
                userAgent: true,
              },
              orderBy: { createdAt: "desc" },
              take: 5,
            },
          }),
        },
        orderBy: { createdAt: "desc" },
        take: userIds ? undefined : 1000,
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
          format: "csv",
          data: [headers, ...csvRows],
          count: users.length,
        };
      }

      return {
        format: "json",
        data: users,
        count: users.length,
      };
    }),
});
