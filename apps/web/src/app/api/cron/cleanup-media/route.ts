import { prisma } from "@asm/db";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { asmobClient } from "@/lib/object-storage";

const ASMOB_BUCKET = process.env.ASMOB_BUCKET_NAME || "uploads";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Media cleanup requires multiple storage operations and batch processing
async function cleanupUnusedMedia() {
  const logs: string[] = [];
  const startTime = Date.now();

  const log = (message: string) => {
    console.log(message);
    logs.push(message);
  };

  const results = {
    deletedFromDb: 0,
    deletedFromZephob: 0,
    errors: [] as string[],
    foundFiles: 0,
  };

  try {
    log("🚀 Starting media cleanup process");

    const unusedMedia = await prisma.media.findMany({
      select: {
        createdAt: true,
        id: true,
        key: true,
        mimeType: true,
        size: true,
        type: true,
      },
      where: {
        createdAt: {
          lte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
        postId: null,
      },
    });

    results.foundFiles = unusedMedia.length;
    log(`🔍 Found ${unusedMedia.length} unused media files`);

    const validMedia = unusedMedia.filter((m) => m.key);
    log(`📊 ${validMedia.length} files have valid storage keys`);

    if (validMedia.length > 0) {
      for (const file of validMedia) {
        log(`📝 Queued for deletion: ${file.key}
        Type: ${file.type}
        MIME: ${file.mimeType}
        Size: ${(file.size / 1024 / 1024).toFixed(2)}MB
        Age: ${Math.floor((Date.now() - file.createdAt.getTime()) / (1000 * 60 * 60))} hours`);
      }

      const batchSize = 50;
      for (let i = 0; i < validMedia.length; i += batchSize) {
        const batch = validMedia.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(validMedia.length / batchSize);

        log(
          `\n🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)`
        );

        try {
          const asmobResults = await Promise.allSettled(
            batch.map((media) =>
              asmobClient.send(
                new DeleteObjectCommand({
                  Bucket: ASMOB_BUCKET,
                  Key: media.key,
                })
              )
            )
          );

          asmobResults.forEach((result, index) => {
            if (result.status === "fulfilled") {
              results.deletedFromZephob++;
              if (batch[index]) {
                log(`✅ Deleted from storage: ${batch[index].key}`);
              }
            } else {
              const errorMessage = `Failed to delete from storage: ${batch[index]?.key ?? "unknown"} - ${result.reason}`;
              log(`❌ ${errorMessage}`);
              results.errors.push(errorMessage);
            }
          });

          const dbResult = await prisma.media.deleteMany({
            where: {
              id: {
                in: batch.map((m) => m.id),
              },
            },
          });

          results.deletedFromDb += dbResult.count;
          log(`✅ Deleted ${dbResult.count} records from database`);

          if (i + batchSize < validMedia.length) {
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        } catch (error) {
          const errorMessage = `Error processing batch ${batchNumber}: ${
            error instanceof Error ? error.message : String(error)
          }`;
          log(`❌ ${errorMessage}`);
          results.errors.push(errorMessage);
        }
      }
    } else {
      log("✨ No valid media files to delete");
    }

    const summary = {
      duration: Date.now() - startTime,
      success: true,
      ...results,
      logs,
      timestamp: new Date().toISOString(),
    };

    log(`\n✨ Media cleanup completed successfully:
    Duration: ${summary.duration}ms
    Files Found: ${results.foundFiles}
    Deleted from Storage: ${results.deletedFromZephob}
    Deleted from Database: ${results.deletedFromDb}
    Errors: ${results.errors.length}`);

    return summary;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`❌ Media cleanup failed: ${errorMessage}`);
    console.error(
      "Cleanup error stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );

    return {
      duration: Date.now() - startTime,
      success: false,
      ...results,
      error: errorMessage,
      logs,
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
  console.log("📥 Received media cleanup request");

  try {
    if (!process.env.CRON_SECRET_KEY) {
      console.error("❌ CRON_SECRET_KEY environment variable not set");
      return NextResponse.json(
        {
          error: "Server configuration error",
          timestamp: new Date().toISOString(),
        },
        {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json",
          },
          status: 500,
        }
      );
    }

    const authHeader = request.headers.get("authorization");
    const expectedAuth = `Bearer ${process.env.CRON_SECRET_KEY}`;

    if (!authHeader || authHeader !== expectedAuth) {
      console.warn("⚠️ Unauthorized media cleanup attempt");
      return NextResponse.json(
        {
          error: "Unauthorized",
          timestamp: new Date().toISOString(),
        },
        {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json",
          },
          status: 401,
        }
      );
    }

    const results = await cleanupUnusedMedia();

    return NextResponse.json(results, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
      status: results.success ? 200 : 500,
    });
  } catch (error) {
    console.error("❌ Media cleanup route error:", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        success: false,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
        },
        status: 500,
      }
    );
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
