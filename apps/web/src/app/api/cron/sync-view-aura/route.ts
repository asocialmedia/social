import { prisma } from "@asm/db";
import { NextResponse } from "next/server";

const VIEWS_AURA_CONFIG = {
  fiftyViews: {
    threshold: 50,
    aura: 10,
  },
  thousandViews: {
    threshold: 1000,
    aura: 100,
  },
};

async function awardViewAura() {
  const logs: string[] = [];
  const startTime = Date.now();

  const log = (message: string) => {
    console.log(message);
    logs.push(message);
  };

  const results = {
    processedPosts: 0,
    auraAwarded: 0,
    errors: [] as string[],
  };

  try {
    log("🚀 Starting post view aura awards");

    const posts = await prisma.post.findMany({
      select: {
        id: true,
        userId: true,
        viewCount: true,
        lastAwardedViewCount: true,
        aura: true,
      },
    });

    log(`📊 Found ${posts.length} posts to process`);

    async function processPost(postIndex: number): Promise<void> {
      if (postIndex >= posts.length) {
        return;
      }

      const post = posts[postIndex];

      try {
        const lastAwardedCount = post.lastAwardedViewCount || 0;
        const currentViews = post.viewCount;

        if (currentViews > lastAwardedCount) {
          const previousFifties = Math.floor(
            lastAwardedCount / VIEWS_AURA_CONFIG.fiftyViews.threshold
          );
          const currentFifties = Math.floor(
            currentViews / VIEWS_AURA_CONFIG.fiftyViews.threshold
          );
          const previousThousands = Math.floor(
            lastAwardedCount / VIEWS_AURA_CONFIG.thousandViews.threshold
          );
          const currentThousands = Math.floor(
            currentViews / VIEWS_AURA_CONFIG.thousandViews.threshold
          );

          const fiftyMilestonesReached = currentFifties - previousFifties;
          const thousandMilestonesReached =
            currentThousands - previousThousands;

          const auraToAward =
            fiftyMilestonesReached * VIEWS_AURA_CONFIG.fiftyViews.aura +
            thousandMilestonesReached * VIEWS_AURA_CONFIG.thousandViews.aura;

          if (auraToAward > 0) {
            await prisma.$transaction(async (tx) => {
              await tx.post.update({
                where: { id: post.id },
                data: {
                  aura: { increment: auraToAward },
                  lastAwardedViewCount: currentViews,
                },
              });

              await tx.user.update({
                where: { id: post.userId },
                data: {
                  aura: { increment: auraToAward },
                },
              });

              await tx.auraLog.create({
                data: {
                  userId: post.userId,
                  issuerId: post.userId,
                  amount: auraToAward,
                  type: "POST_VIEWS_MILESTONE",
                  postId: post.id,
                },
              });

              log(
                `✨ Awarded ${auraToAward} aura to post ${post.id} and user ${post.userId} (${currentViews} views)`
              );
            });

            results.auraAwarded += auraToAward;
            results.processedPosts += 1;
          }
        }
      } catch (error) {
        const errorMessage = `Error processing post ${post.id}: ${error instanceof Error ? error.message : String(error)}`;
        log(`❌ ${errorMessage}`);
        results.errors.push(errorMessage);
      }

      await processPost(postIndex + 1);
    }

    await processPost(0);

    const summary = {
      success: true,
      duration: Date.now() - startTime,
      ...results,
      logs,
      stats: {
        totalPosts: posts.length,
        postsAwarded: results.processedPosts,
        totalAuraAwarded: results.auraAwarded,
      },
      timestamp: new Date().toISOString(),
    };

    log(`\n✨ Post aura awards completed:
    Duration: ${summary.duration}ms
    Posts Processed: ${summary.stats.totalPosts}
    Posts Awarded: ${summary.stats.postsAwarded}
    Total Aura Awarded: ${summary.stats.totalAuraAwarded}
    Errors: ${results.errors.length}`);

    return summary;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log(`❌ Fatal error in aura awards: ${errorMessage}`);
    return {
      success: false,
      duration: Date.now() - startTime,
      error: errorMessage,
      logs,
      timestamp: new Date().toISOString(),
    };
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

    const results = await awardViewAura();

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
