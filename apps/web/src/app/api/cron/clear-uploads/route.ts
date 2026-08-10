import { prisma } from "@asm/db";
import { NextResponse } from "next/server";
import { deleteAvatar } from "@/lib/object-storage";

async function clearUploads() {
  const logs: string[] = [];
  const startTime = Date.now();

  const log = (message: string) => {
    console.log(message);
    logs.push(message);
  };

  const results = {
    mediaProcessed: 0,
    mediaDeleted: 0,
    avatarsProcessed: 0,
    avatarsDeleted: 0,
    errors: [] as string[],
  };

  try {
    log("🚀 Starting uploads cleanup process");

    // 1. Handle unused media files
    log("\n🔍 Finding unused media files...");
    const unusedMedia = await prisma.media.findMany({
      where: {
        postId: null,
        ...(process.env.NODE_ENV === "production"
          ? {
              createdAt: {
                lte: new Date(Date.now() - 1000 * 60 * 60 * 24), // 24 hours
              },
            }
          : {}),
      },
      select: {
        id: true,
        key: true,
        type: true,
        mimeType: true,
        size: true,
        createdAt: true,
      },
    });

    results.mediaProcessed = unusedMedia.length;
    log(`📊 Found ${unusedMedia.length} unused media files`);

    if (unusedMedia.length > 0) {
      const batchSize = 50;

      async function processMediaBatches(
        batchStartIndex: number
      ): Promise<void> {
        if (batchStartIndex >= unusedMedia.length) {
          return;
        }

        const batch = unusedMedia.slice(
          batchStartIndex,
          batchStartIndex + batchSize
        );
        const batchNumber = Math.floor(batchStartIndex / batchSize) + 1;
        const totalBatches = Math.ceil(unusedMedia.length / batchSize);

        log(
          `\n🔄 Processing media batch ${batchNumber}/${totalBatches} (${batch.length} files)`
        );

        // Log details of files to be deleted
        for (const file of batch) {
          log(`📝 Queued for deletion: ${file.key}
          Type: ${file.type}
          MIME: ${file.mimeType}
          Size: ${(file.size / 1024 / 1024).toFixed(2)}MB
          Age: ${Math.floor((Date.now() - file.createdAt.getTime()) / (1000 * 60 * 60))} hours`);
        }

        await Promise.allSettled(
          batch.map(async (media) => {
            if (media.key) {
              try {
                await deleteAvatar(media.key);
                results.mediaDeleted += 1;
                log(`✅ Deleted file: ${media.key}`);
                return true;
              } catch (error) {
                const errorMessage = `Error deleting file ${media.key}: ${
                  error instanceof Error ? error.message : String(error)
                }`;
                log(`❌ ${errorMessage}`);
                results.errors.push(errorMessage);
                return false;
              }
            }
            return false;
          })
        );

        try {
          const deleteResult = await prisma.media.deleteMany({
            where: {
              id: {
                in: batch.map((m) => m.id),
              },
            },
          });
          log(`✅ Deleted ${deleteResult.count} database records`);
        } catch (error) {
          const errorMessage = `Error deleting database records: ${
            error instanceof Error ? error.message : String(error)
          }`;
          log(`❌ ${errorMessage}`);
          results.errors.push(errorMessage);
        }

        if (batchStartIndex + batchSize < unusedMedia.length) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        await processMediaBatches(batchStartIndex + batchSize);
      }

      await processMediaBatches(0);
    }

    // 2. Handle orphaned avatars
    log("\n🔍 Finding orphaned user avatars...");
    const orphanedAvatars = await prisma.user.findMany({
      where: {
        avatarKey: { not: null },
        AND: { avatarUrl: null },
      },
      select: {
        id: true,
        username: true,
        avatarKey: true,
      },
    });

    results.avatarsProcessed = orphanedAvatars.length;
    log(`📊 Found ${orphanedAvatars.length} orphaned avatars`);

    if (orphanedAvatars.length > 0) {
      const batchSize = 25;

      async function processAvatarBatches(
        batchStartIndex: number
      ): Promise<void> {
        if (batchStartIndex >= orphanedAvatars.length) {
          return;
        }

        const batch = orphanedAvatars.slice(
          batchStartIndex,
          batchStartIndex + batchSize
        );
        const batchNumber = Math.floor(batchStartIndex / batchSize) + 1;
        const totalBatches = Math.ceil(orphanedAvatars.length / batchSize);

        log(
          `\n🔄 Processing avatars batch ${batchNumber}/${totalBatches} (${batch.length} avatars)`
        );

        await Promise.allSettled(
          batch.map(async (user) => {
            if (user.avatarKey) {
              try {
                await deleteAvatar(user.avatarKey);
                await prisma.user.update({
                  where: { id: user.id },
                  data: { avatarKey: null },
                });
                results.avatarsDeleted += 1;
                log(
                  `✅ Deleted orphaned avatar for user ${user.username}: ${user.avatarKey}`
                );
                return true;
              } catch (error) {
                const errorMessage = `Error deleting avatar for user ${user.username}: ${
                  error instanceof Error ? error.message : String(error)
                }`;
                log(`❌ ${errorMessage}`);
                results.errors.push(errorMessage);
                return false;
              }
            }
            return false;
          })
        );

        if (batchStartIndex + batchSize < orphanedAvatars.length) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        await processAvatarBatches(batchStartIndex + batchSize);
      }

      await processAvatarBatches(0);
    }

    const summary = {
      success: true,
      duration: Date.now() - startTime,
      ...results,
      logs,
      timestamp: new Date().toISOString(),
    };

    log(`\n✨ Uploads cleanup completed successfully:
    Duration: ${summary.duration}ms
    Media Files:
      - Processed: ${results.mediaProcessed}
      - Deleted: ${results.mediaDeleted}
    Avatars:
      - Processed: ${results.avatarsProcessed}
      - Deleted: ${results.avatarsDeleted}
    Errors: ${results.errors.length}`);

    return summary;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log(`❌ Uploads cleanup failed: ${errorMessage}`);
    console.error(
      "Cleanup error stack:",
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

export async function POST(request: Request) {
  console.log("📥 Received uploads cleanup request");

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
      console.warn("⚠️ Unauthorized uploads cleanup attempt");
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

    const results = await clearUploads();

    return NextResponse.json(results, {
      status: results.success ? 200 : 500,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("❌ Uploads cleanup route error:", {
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
