import { prisma } from "@asm/db";
import { NextResponse } from "next/server";

async function getInactiveUserStats(
  thirtyDaysAgo: Date,
  log: (message: string) => void
): Promise<{ totalUsers: number; inactiveCount: number }> {
  const totalUsers = await prisma.user.count();
  log(`📊 Current total users: ${totalUsers}`);

  const inactiveCount = await prisma.user.count({
    where: {
      AND: [{ emailVerified: false }, { createdAt: { lt: thirtyDaysAgo } }],
    },
  });

  log(
    `🔍 Found ${inactiveCount} inactive users (${((inactiveCount / totalUsers) * 100).toFixed(2)}% of total)`
  );

  return { totalUsers, inactiveCount };
}

async function deleteInactiveUsersInBatches(
  thirtyDaysAgo: Date,
  inactiveCount: number,
  log: (message: string) => void,
  results: { errors: string[] }
): Promise<number> {
  const batchSize = 100;
  let totalDeleted = 0;
  const totalBatches = Math.ceil(inactiveCount / batchSize);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const offset = batchIndex * batchSize;
    const currentBatchSize = Math.min(batchSize, inactiveCount - offset);

    try {
      const batch = await prisma.user.findMany({
        where: {
          AND: [{ emailVerified: false }, { createdAt: { lt: thirtyDaysAgo } }],
        },
        select: { id: true, username: true },
        skip: offset,
        take: currentBatchSize,
      });

      if (batch.length === 0) {
        break;
      }

      const userIds = batch.map((user) => user.id);
      const usernames = batch.map((user) => user.username);

      const deleteResult = await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });

      totalDeleted += deleteResult.count;

      log(
        `🗑️  Batch ${batchIndex + 1}/${totalBatches}: Deleted ${deleteResult.count} users (${usernames.slice(0, 3).join(", ")}${usernames.length > 3 ? "..." : ""})`
      );
    } catch (error) {
      const errorMessage = `Error deleting batch ${batchIndex + 1}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
      log(`❌ ${errorMessage}`);
      results.errors.push(errorMessage);
    }
  }

  return totalDeleted;
}

async function cleanupInactiveUsers() {
  const logs: string[] = [];
  const startTime = Date.now();

  const log = (message: string) => {
    console.log(message);
    logs.push(message);
  };

  try {
    log("🚀 Starting inactive users cleanup job");

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { totalUsers, inactiveCount } = await getInactiveUserStats(
      thirtyDaysAgo,
      log
    );

    if (inactiveCount === 0) {
      log("✨ No inactive users to clean up");
      return {
        success: true,
        deletedCount: 0,
        duration: Date.now() - startTime,
        logs,
        stats: {
          totalUsers,
          inactiveUsers: 0,
          deletionPercentage: "0.00",
        },
        timestamp: new Date().toISOString(),
      };
    }

    const results = { errors: [] as string[] };
    const totalDeleted = await deleteInactiveUsersInBatches(
      thirtyDaysAgo,
      inactiveCount,
      log,
      results
    );

    const remainingUsers = totalUsers - totalDeleted;
    const deletionPercentage = ((totalDeleted / totalUsers) * 100).toFixed(2);

    const summary = {
      success: true,
      deletedCount: totalDeleted,
      duration: Date.now() - startTime,
      logs,
      stats: {
        totalUsers,
        inactiveUsers: inactiveCount,
        deletionPercentage,
      },
      timestamp: new Date().toISOString(),
    };

    log(`✨ Cleanup completed successfully:
    - Total Deleted: ${totalDeleted} users
    - Duration: ${summary.duration}ms
    - Before: ${totalUsers}
    - After: ${remainingUsers}
    - Cleaned: ${deletionPercentage}%`);

    return summary;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log(`❌ Failed to cleanup inactive users: ${errorMessage}`);
    console.error(
      "Cleanup error stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );

    return {
      success: false,
      duration: Date.now() - startTime,
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

export async function GET() {
  try {
    const result = await cleanupInactiveUsers();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Route handler error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
