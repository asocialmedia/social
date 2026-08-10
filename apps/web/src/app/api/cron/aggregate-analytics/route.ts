import { prisma, redis } from "@asm/db";
import { NextResponse } from "next/server";

async function aggregateAnalytics() {
  const logs: string[] = [];
  const startTime = Date.now();

  const log = (message: string) => {
    console.log(message);
    logs.push(message);
  };

  const results = {
    processedViews: 0,
    processedUsers: 0,
    updatedPosts: 0,
    updatedUserMetrics: 0,
    errors: [] as string[],
  };

  try {
    log("🚀 Starting analytics aggregation");

    try {
      await redis.ping();
      log("✅ Redis connection successful");
    } catch (redisError) {
      log("❌ Redis connection failed");
      throw new Error("Redis connection failed", { cause: redisError });
    }

    // 1. Aggregate post views
    log("\n📊 Starting post views aggregation");
    const postViews = await redis.smembers("posts:with:views");
    log(`Found ${postViews.length} posts with views to process`);

    const viewsData: { postId: string; views: number }[] = [];

    const viewEntries = await Promise.all(
      postViews.map(async (postId) => {
        try {
          const views = await redis.get(`post:views:${postId}`);
          if (views) {
            return { postId, views: Number.parseInt(views, 10) };
          }
          return null;
        } catch (error) {
          const errorMessage = `Error processing views for post ${postId}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`;
          log(`❌ ${errorMessage}`);
          results.errors.push(errorMessage);
          return null;
        }
      })
    );

    for (const entry of viewEntries) {
      if (entry) {
        viewsData.push(entry);
      }
      results.processedViews += 1;

      if (results.processedViews % 100 === 0) {
        log(
          `🔄 Processed ${results.processedViews}/${postViews.length} post views`
        );
      }
    }

    const batchSize = 100;
    log(`\n📝 Updating post view counts in batches of ${batchSize}`);

    async function updatePostBatches(batchStartIndex: number): Promise<void> {
      if (batchStartIndex >= viewsData.length) {
        return;
      }

      const batch = viewsData.slice(
        batchStartIndex,
        batchStartIndex + batchSize
      );
      const batchNumber = Math.floor(batchStartIndex / batchSize) + 1;
      const totalBatches = Math.ceil(viewsData.length / batchSize);

      try {
        await Promise.all(
          batch.map((data) =>
            prisma.post.update({
              where: { id: data.postId },
              data: { viewCount: data.views },
            })
          )
        );
        results.updatedPosts += batch.length;
        log(
          `✅ Batch ${batchNumber}/${totalBatches}: Updated ${batch.length} posts`
        );

        if (batchStartIndex + batchSize < viewsData.length) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch (error) {
        const errorMessage = `Error updating post batch ${batchNumber}/${totalBatches}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`;
        log(`❌ ${errorMessage}`);
        results.errors.push(errorMessage);
      }

      await updatePostBatches(batchStartIndex + batchSize);
    }

    await updatePostBatches(0);

    // 2. Aggregate user metrics
    log("\n👥 Starting user metrics aggregation");
    const userMetrics = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        _count: {
          select: {
            posts: true,
            followers: true,
            following: true,
            comments: true,
          },
        },
      },
    });

    results.processedUsers = userMetrics.length;
    log(`Found ${userMetrics.length} users to process`);

    async function updateMetricsBatches(
      batchStartIndex: number
    ): Promise<void> {
      if (batchStartIndex >= userMetrics.length) {
        return;
      }

      const batch = userMetrics.slice(
        batchStartIndex,
        batchStartIndex + batchSize
      );
      const batchNumber = Math.floor(batchStartIndex / batchSize) + 1;
      const totalBatches = Math.ceil(userMetrics.length / batchSize);

      const pipeline = redis.pipeline();

      for (const user of batch) {
        pipeline.hset(`user:metrics:${user.id}`, {
          posts: user._count.posts,
          followers: user._count.followers,
          following: user._count.following,
          comments: user._count.comments,
          lastUpdated: new Date().toISOString(),
        });
        pipeline.expire(`user:metrics:${user.id}`, 86_400); // 24 hours
      }

      try {
        await pipeline.exec();
        results.updatedUserMetrics += batch.length;
        log(
          `✅ Batch ${batchNumber}/${totalBatches}: Updated metrics for ${batch.length} users`
        );

        if (batchStartIndex + batchSize < userMetrics.length) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch (error) {
        const errorMessage = `Error updating user metrics batch ${batchNumber}/${totalBatches}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`;
        log(`❌ ${errorMessage}`);
        results.errors.push(errorMessage);
      }

      await updateMetricsBatches(batchStartIndex + batchSize);
    }

    await updateMetricsBatches(0);

    const summary = {
      success: true,
      duration: Date.now() - startTime,
      ...results,
      logs,
      timestamp: new Date().toISOString(),
    };

    log(`\n✨ Analytics aggregation completed successfully:
    Duration: ${summary.duration}ms
    Processed Views: ${results.processedViews}
    Updated Posts: ${results.updatedPosts}
    Processed Users: ${results.processedUsers}
    Updated User Metrics: ${results.updatedUserMetrics}
    Errors: ${results.errors.length}`);

    return summary;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log(`\n❌ Analytics aggregation failed: ${errorMessage}`);
    console.error(
      "Aggregation error stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );

    return {
      success: false,
      duration: Date.now() - startTime,
      ...results,
      logs,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    };
  } finally {
    try {
      await prisma.$disconnect();
      log("👋 Database connection closed");
    } catch {
      log("❌ Error closing database connection");
    }
  }
}

export async function GET(request: Request) {
  console.log("📥 Received analytics aggregation request");

  try {
    if (!process.env.CRON_SECRET_KEY) {
      console.error("❌ CRON_SECRET_KEY environment variable not set");
      return NextResponse.json(
        {
          error: "Server configuration error",
          timestamp: new Date().toISOString(),
        },
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const authHeader = request.headers.get("authorization");
    const expectedAuth = `Bearer ${process.env.CRON_SECRET_KEY}`;

    if (!authHeader || authHeader !== expectedAuth) {
      console.warn("⚠️ Unauthorized analytics aggregation attempt");
      return NextResponse.json(
        {
          error: "Unauthorized",
          timestamp: new Date().toISOString(),
        },
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const results = await aggregateAnalytics();

    return NextResponse.json(results, {
      status: results.success ? 200 : 500,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("❌ Analytics route error:", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
