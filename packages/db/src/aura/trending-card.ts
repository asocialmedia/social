import type { TransactionClient } from "../../prisma/generated/prisma/internal/prismaNamespace";
import prisma from "../prisma";
import { redis } from "../redis";

import { TRENDING_CARD_AURA } from "./config";
import { invalidateAuraSignals } from "./signals";

// Appearing in the trending users card pays a flat profile award, deduped to
// once per user per UTC day. The Redis SET NX is the dedupe gate: only the
// caller that claims an unclaimed slot pays, so sidebar refreshes (60s cached
// route, many viewers) can never re-print the award. Best-effort by design -
// failures cost at most one day's award.

const TRENDING_CARD_KEY_PREFIX = "aura:trending-card:";

function trendingCardKey(userId: string, now: Date): string {
  const utcDay = now.toISOString().slice(0, 10);
  return `${TRENDING_CARD_KEY_PREFIX}${utcDay}:${userId}`;
}

export async function awardTrendingCardPresence(
  userIds: string[],
  now: Date = new Date()
): Promise<number> {
  let awardedCount = 0;

  for (const userId of userIds) {
    try {
      const claimed = await redis.set(
        trendingCardKey(userId, now),
        "1",
        "EX",
        // Two days of TTL comfortably covers the UTC-day dedupe window.
        172_800,
        "NX"
      );
      if (claimed !== "OK") {
        continue;
      }
    } catch {
      // Redis unavailable: skip rather than risk double-paying.
      continue;
    }

    try {
      await prisma.$transaction(async (tx: TransactionClient) => {
        await tx.user.update({
          data: { aura: { increment: TRENDING_CARD_AURA } },
          where: { id: userId },
        });
        await tx.auraLog.create({
          data: {
            amount: TRENDING_CARD_AURA,
            issuerId: userId,
            targetUserId: userId,
            type: "TRENDING_APPEARANCE",
            userId,
          },
        });
      });
      awardedCount += 1;
      await invalidateAuraSignals([userId]);
    } catch {
      // Balance write failed: release nothing - the claim stands for today,
      // which errs conservative (under-pay) instead of double-paying.
    }
  }

  return awardedCount;
}
