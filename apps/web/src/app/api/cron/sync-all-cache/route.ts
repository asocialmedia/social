import {
  avatarCache,
  followerInfoCache,
  POST_VIEWS_KEY_PREFIX,
  POST_VIEWS_SET,
  prisma,
  redis,
  shareStatsCache,
  tagCache,
  trendingTopicsCache,
} from "@asm/db";
import { NextResponse } from "next/server";

const BATCH_SIZE = 100;

async function validateRedisConnection(log: (message: string) => void) {
  try {
    await redis.ping();
    log("✅ Redis connection successful");
    return true;
  } catch (error) {
    log(`❌ Redis connection failed: ${error}`);
    return false;
  }
}

// biome-ignore lint/suspicious/noExplicitAny: Any type is used here due to Redis SDK limitations
async function syncViewCounts(log: (message: string) => void, results: any) {
  log("\n📊 Syncing view counts...");
  try {
    const postsWithViews = await redis.smembers(POST_VIEWS_SET);
    log(`Found ${postsWithViews.length} posts with views in Redis`);

    if (postsWithViews.length === 0) {
      log("No posts found with views to sync");
      return;
    }

    const pipeline = redis.pipeline();
    for (const postId of postsWithViews) {
      pipeline.get(`${POST_VIEWS_KEY_PREFIX}${postId}`);
    }

    const pipelineResults = await pipeline.exec();
    if (!pipelineResults) {
      throw new Error("Pipeline execution returned null");
    }

    const updates = postsWithViews
      .map((postId, index) => {
        const [error, value] = pipelineResults[index] || [];
        if (error) {
          log(`Error getting views for post ${postId}: ${error}`);
          return null;
        }
        return { postId, views: Number(value) || 0 };
      })
      .filter(
        (update): update is { postId: string; views: number } =>
          update !== null && update.views > 0
      );

    async function processViewBatches(batchStartIndex: number): Promise<void> {
      if (batchStartIndex >= updates.length) {
        return;
      }

      const batch = updates.slice(
        batchStartIndex,
        batchStartIndex + BATCH_SIZE
      );
      await prisma.$transaction(
        batch.map(({ postId, views }) =>
          prisma.post.update({
            where: { id: postId },
            data: { viewCount: views },
          })
        )
      );
      log(
        `Updated batch ${Math.floor(batchStartIndex / BATCH_SIZE) + 1} of ${Math.ceil(
          updates.length / BATCH_SIZE
        )}`
      );
      await processViewBatches(batchStartIndex + BATCH_SIZE);
    }

    await processViewBatches(0);

    results.viewCountsSync = updates.length;
    log(`✅ Synced view counts for ${updates.length} posts`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`❌ Error syncing view counts: ${errorMessage}`);
    results.errors.push(`View counts sync error: ${errorMessage}`);
  }
}

// biome-ignore lint/suspicious/noExplicitAny: Any type is used here due to Redis SDK limitations
async function syncShareStats(log: (message: string) => void, results: any) {
  log("\n🔄 Syncing share stats...");
  try {
    const posts = await prisma.post.findMany({
      select: { id: true },
    });

    const platforms = ["twitter", "facebook", "linkedin"];
    let syncedCount = 0;

    async function syncShareStatsForPost(postIndex: number): Promise<void> {
      if (postIndex >= posts.length) {
        return;
      }

      const post = posts[postIndex];
      await Promise.all(
        platforms.map(async (platform) => {
          const stats = await shareStatsCache.getStats(post.id, platform);
          if (stats.shares > 0 || stats.clicks > 0) {
            await prisma.shareStats.upsert({
              where: {
                postId_platform: {
                  postId: post.id,
                  platform,
                },
              },
              create: {
                postId: post.id,
                platform,
                shares: stats.shares,
                clicks: stats.clicks,
              },
              update: {
                shares: stats.shares,
                clicks: stats.clicks,
              },
            });
            syncedCount += 1;
          }
        })
      );

      await syncShareStatsForPost(postIndex + 1);
    }

    await syncShareStatsForPost(0);

    results.shareStatsSync = syncedCount;
    log(`✅ Synced ${syncedCount} share stats records`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`❌ Error syncing share stats: ${errorMessage}`);
    results.errors.push(`Share stats sync error: ${errorMessage}`);
  }
}

// biome-ignore lint/suspicious/noExplicitAny: Any type is used here due to Redis SDK limitations
async function syncTagCounts(log: (message: string) => void, results: any) {
  log("\n🏷️ Syncing tag counts...");
  try {
    await tagCache.syncTagCounts();
    results.tagCountsSync = 1;
    log("✅ Successfully synced tag counts");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`❌ Error syncing tag counts: ${errorMessage}`);
    results.errors.push(`Tag counts sync error: ${errorMessage}`);
  }
}

// biome-ignore lint/suspicious/noExplicitAny: Any type is used here due to Redis SDK limitations
async function syncAvatars(log: (message: string) => void, results: any) {
  log("\n👤 Syncing avatar cache...");
  try {
    const users = await prisma.user.findMany({
      select: { id: true, avatarUrl: true, avatarKey: true },
    });

    const syncedCount = (
      await Promise.all(
        users.map(async (user) => {
          if (user.avatarUrl) {
            await avatarCache.set(user.id, {
              url: user.avatarUrl,
              key: user.avatarKey || "",
              updatedAt: new Date().toISOString(),
            });
            return 1;
          }
          return 0;
        })
      )
    ).reduce<number>((sum, value) => sum + value, 0);

    results.avatarsSync = syncedCount;
    log(`✅ Synced ${syncedCount} avatar records`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`❌ Error syncing avatars: ${errorMessage}`);
    results.errors.push(`Avatars sync error: ${errorMessage}`);
  }
}

// biome-ignore lint/suspicious/noExplicitAny: Any type is used here due to Redis SDK limitations
async function syncFollowerInfo(log: (message: string) => void, results: any) {
  log("\n👥 Syncing follower info...");
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        _count: {
          select: {
            followers: true,
            following: true,
          },
        },
      },
    });

    async function processFollowerBatches(
      batchStartIndex: number
    ): Promise<void> {
      if (batchStartIndex >= users.length) {
        return;
      }

      const batch = users.slice(batchStartIndex, batchStartIndex + BATCH_SIZE);
      await Promise.all(
        batch.map(async (user) => {
          await followerInfoCache.set(user.id, {
            // @ts-expect-error
            followersCount: user._count.followers,
            followingCount: user._count.following,
            isFollowedByUser: false,
          });
        })
      );
      log(
        `Processed batch ${Math.floor(batchStartIndex / BATCH_SIZE) + 1} of ${Math.ceil(
          users.length / BATCH_SIZE
        )}`
      );
      await processFollowerBatches(batchStartIndex + BATCH_SIZE);
    }

    await processFollowerBatches(0);

    results.followerInfoSync = users.length;
    log(`✅ Synced follower info for ${users.length} users`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`❌ Error syncing follower info: ${errorMessage}`);
    results.errors.push(`Follower info sync error: ${errorMessage}`);
  }
}

async function syncTrendingTopics(
  log: (message: string) => void,
  // biome-ignore lint/suspicious/noExplicitAny: Any type is used here due to Redis SDK limitations
  results: any
) {
  log("\n📈 Syncing trending topics...");
  try {
    await trendingTopicsCache.warmCache();
    results.trendingTopicsSync = 1;
    log("✅ Successfully warmed trending topics cache");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`❌ Error syncing trending topics: ${errorMessage}`);
    results.errors.push(`Trending topics sync error: ${errorMessage}`);
  }
}

async function syncAllCaches() {
  const logs: string[] = [];
  const startTime = Date.now();

  const log = (message: string) => {
    console.log(message);
    logs.push(message);
  };

  const results = {
    viewCountsSync: 0,
    shareStatsSync: 0,
    tagCountsSync: 0,
    avatarsSync: 0,
    followerInfoSync: 0,
    trendingTopicsSync: 0,
    errors: [] as string[],
  };

  if (!(await validateRedisConnection(log))) {
    return {
      success: false,
      error: "Redis connection failed",
      logs,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    log("🚀 Starting cache synchronization...");

    // Run syncs sequentially to avoid overwhelming the database
    await syncViewCounts(log, results);
    await syncShareStats(log, results);
    await syncTagCounts(log, results);
    await syncAvatars(log, results);
    await syncFollowerInfo(log, results);
    await syncTrendingTopics(log, results);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`\n✨ Cache synchronization completed in ${duration}s`);

    const summary = {
      success: true,
      duration: Date.now() - startTime,
      ...results,
      logs,
      stats: {
        viewCountsSynced: results.viewCountsSync,
        shareStatsSynced: results.shareStatsSync,
        tagCountsSynced: results.tagCountsSync,
        avatarsSynced: results.avatarsSync,
        followerInfoSynced: results.followerInfoSync,
        trendingTopicsSynced: results.trendingTopicsSync,
      },
      timestamp: new Date().toISOString(),
    };

    return summary;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log(`❌ Fatal error during cache sync: ${errorMessage}`);
    return {
      success: false,
      duration: Date.now() - startTime,
      error: errorMessage,
      logs,
      timestamp: new Date().toISOString(),
    };
  } finally {
    await prisma.$disconnect();
    await redis.quit();
  }
}

export async function POST(request: Request) {
  try {
    if (!process.env.CRON_SECRET_KEY) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get("authorization");
    const expectedAuth = `Bearer ${process.env.CRON_SECRET_KEY}`;

    if (!authHeader || authHeader !== expectedAuth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const results = await syncAllCaches();

    return NextResponse.json(results, {
      status: results.success ? 200 : 500,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
