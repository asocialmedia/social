import { tagCache } from "@asm/db";
import { NextResponse } from "next/server";

import { getWebLogger } from "@/lib/otel";
import { getSessionFromApi } from "@/lib/session";

// Recomputes denormalized tag counts across every post. That is real
// database work, so it is restricted to admins (the UI never calls this;
// it exists for operators and the worker's refresh cycle).
export async function POST() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user || user.role !== "admin") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    await tagCache.syncTagCounts();
    return NextResponse.json({ success: true });
  } catch (error) {
    const logger = getWebLogger();
    if (logger) {
      logger.error({ error }, "Error syncing tag counts");
    } else {
      console.error("Error syncing tag counts:", error);
    }
    return NextResponse.json({ error: "Failed to sync tags" }, { status: 500 });
  }
}
