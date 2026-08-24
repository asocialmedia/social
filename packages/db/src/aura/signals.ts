import prisma from "../prisma";
import { redis } from "../redis";
import {
  MOMENTUM_BUCKETS,
  SIGNALS_BATCH_MAX_USERS,
  SIGNALS_CACHE_KEY_PREFIX,
  SIGNALS_CACHE_TTL_SECONDS,
} from "./config";
import {
  computeCredibility,
  computeMomentum,
  computeVisibilityWeight,
} from "./engine";
import type { MomentumEntry } from "./engine";

// Derived per-user reputation signals. The lifetime balance (User.aura) stays
// the source of truth and the display number; these are read-only projections
// other features consume WITHOUT recomputing from the ledger:
//
//   - credibility:      how much influence this account's engagement carries
//   - momentum:         recency-weighted recent earnings ("hot right now")
//   - visibilityWeight: soft ranking multiplier for negative balances
//
// STABLE INTERFACE: the feed/trending pipeline consumes getAuraSignals /
// getAuraSignalsForUsers / computeVisibilityWeight. Shape changes must be
// additive and coordinated.

export interface AuraSignals {
  /** 0..1 - influence of this account's engagement on others' aura. */
  credibility: number;
  /** Lifetime balance, mirrors User.aura (display + legacy consumers). */
  lifetimeAura: number;
  /** Recency-weighted ledger earnings over the momentum window; may be negative. */
  momentum: number;
  /** 0.4..1 multiplier for surfacing this user's content; 1 unless aura < 0. */
  visibilityWeight: number;
}

function signalCacheKey(userId: string): string {
  return `${SIGNALS_CACHE_KEY_PREFIX}:${userId}`;
}

// Computes signals fresh from the ledger. Exposed for tests and for cache
// misses; most callers want getAuraSignals.
export async function computeAuraSignals(
  userId: string
): Promise<AuraSignals | null> {
  const user = await prisma.user.findUnique({
    select: { aura: true, createdAt: true },
    where: { id: userId },
  });

  if (!user) {
    return null;
  }

  return buildSignals(user.aura, user.createdAt, new Date(), userId);
}

async function buildSignals(
  lifetimeAura: number,
  accountCreatedAt: Date,
  now: Date,
  userId: string
): Promise<AuraSignals> {
  const oldestBucketHours = MOMENTUM_BUCKETS.at(-1)?.maxAgeHours ?? 0;
  const windowStart = new Date(now.getTime() - oldestBucketHours * 3_600_000);

  const entries = await prisma.auraLog.findMany({
    select: { amount: true, createdAt: true },
    where: { createdAt: { gte: windowStart }, userId },
  });

  const momentumEntries: MomentumEntry[] = entries.map(
    (entry: { amount: number; createdAt: Date }) => ({
      amount: entry.amount,
      createdAt: entry.createdAt,
    })
  );

  return {
    credibility: computeCredibility({
      accountAgeDays: (now.getTime() - accountCreatedAt.getTime()) / 86_400_000,
      lifetimeAura,
    }),
    lifetimeAura,
    momentum: computeMomentum(momentumEntries, now),
    visibilityWeight: computeVisibilityWeight(lifetimeAura),
  };
}

// Cached signal lookup. Redis or ledger failures degrade to null: signals
// are advisory ranking inputs and consumers treat null as "use neutral
// weights", matching the fail-open style of the other caches here.
export async function getAuraSignals(
  userId: string
): Promise<AuraSignals | null> {
  try {
    const cached = await redis.get(signalCacheKey(userId));
    if (cached) {
      return JSON.parse(cached) as AuraSignals;
    }
  } catch {
    // Cache miss by way of Redis being down - fall through to live compute.
  }

  let signals: AuraSignals | null;
  try {
    signals = await computeAuraSignals(userId);
  } catch {
    // Ledger unavailable - advisory signal, so degrade instead of throwing.
    return null;
  }
  if (!signals) {
    return null;
  }

  void setCachedSignals(userId, signals);
  return signals;
}

// Batch variant for scoring pipelines. Bounded by SIGNALS_BATCH_MAX_USERS so
// a caller cannot accidentally fan out over the whole user base.
export async function getAuraSignalsForUsers(
  userIds: string[]
): Promise<Map<string, AuraSignals>> {
  const results = new Map<string, AuraSignals>();
  const bounded = userIds.slice(0, SIGNALS_BATCH_MAX_USERS);

  const lookups = await Promise.all(
    bounded.map(async (id) => ({ id, signals: await getAuraSignals(id) }))
  );
  for (const { id, signals } of lookups) {
    if (signals) {
      results.set(id, signals);
    }
  }

  return results;
}

// Eager invalidation after ledger mutations. Best-effort: the TTL is the
// correctness backstop, so callers fire-and-forget this after commit.
export async function invalidateAuraSignals(userIds: string[]): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
  try {
    await redis.del(...userIds.map((id) => signalCacheKey(id)));
  } catch {
    // Signals serve ranking heuristics; stale-until-TTL is acceptable.
  }
}

async function setCachedSignals(
  userId: string,
  signals: AuraSignals
): Promise<void> {
  try {
    await redis.setex(
      signalCacheKey(userId),
      SIGNALS_CACHE_TTL_SECONDS,
      JSON.stringify(signals)
    );
  } catch {
    // Fail-open: an unwritable cache only costs a recompute.
  }
}
