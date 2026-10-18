import { createHash } from "node:crypto";

import {
  defaultNetworkPreferences,
  networkPreferencesSchema,
  normalizeInterest,
} from "@asm/protocols/discovery";
import type {
  NetworkPreferences,
  NetworkSettings,
} from "@asm/protocols/discovery";
import { z } from "zod";

import source from "../../sql/recommendation/network.sql" with { type: "text" };
import { rawQuery } from "../messages/infrastructure/raw-sql";
import { readSqlBundle } from "../messages/infrastructure/sql-template";
import prisma from "../prisma";
import { redis } from "../redis";
import { getRecommendationProfile } from "./feed-service";
import { networkTopicCatalog, networkTopicScope } from "./network-topics";
import { buildUserProfile } from "./profile";
import type { ProfileSignal, UserProfile } from "./profile";
import {
  loadSharedTopicGraph,
  recordSharedTopicRelations,
} from "./shared-topic-graph";

export const networkSql = readSqlBundle(source, {
  network: ["save", "candidates", "creators"],
}).network;
export const NETWORK_SIGNAL_RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const NETWORK_FEED_TTL_SECONDS = 10 * 60;
const kinds = [
  "amplify",
  "downvote",
  "bookmark",
  "comment",
  "dwell",
  "viewComplete",
  "skip",
  "notInterested",
  "search",
] as const;
export const networkSignalSchema = z.object({
  authorId: z.string().max(2300),
  createdAt: z.number().finite(),
  hasImage: z.boolean().optional(),
  hasVideo: z.boolean().optional(),
  kind: z.enum(kinds),
  tags: z.array(z.string().max(64)).max(20),
});
type NetworkSignal = z.infer<typeof networkSignalSchema>;
const RECORD = `
if redis.call('ZSCORE', KEYS[3], ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[3], ARGV[1], ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[5])
redis.call('ZREMRANGEBYRANK', KEYS[3], 0, -2001)
redis.call('EXPIRE', KEYS[3], ARGV[4])
local stale = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[5])
for _, id in ipairs(stale) do redis.call('HDEL', KEYS[2], id) end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[5])
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
local excess = redis.call('ZRANGE', KEYS[1], 0, -501)
for _, id in ipairs(excess) do redis.call('ZREM', KEYS[1], id); redis.call('HDEL', KEYS[2], id) end
redis.call('EXPIRE', KEYS[1], ARGV[4]); redis.call('EXPIRE', KEYS[2], ARGV[4])
return 1
`;

export class NetworkPreferenceConflictError extends Error {
  override name = "NetworkPreferenceConflictError";
}

function signalPrefix(userId: string, profileId: string): string {
  return `rec:network:v1:{${userId}:${profileId}}`;
}

export async function readNetworkPreferences(
  userId: string
): Promise<{ preferences: NetworkPreferences; revision: number }> {
  const row = await prisma.orm.public.Users.select(
    "networkPreferences",
    "networkPreferencesRevision"
  )
    .where({ id: userId })
    .first();
  if (!row) {
    throw new Error("Account not found");
  }
  const parsed = networkPreferencesSchema.safeParse(row.networkPreferences);
  return {
    preferences: parsed.success ? parsed.data : defaultNetworkPreferences(),
    revision: row.networkPreferencesRevision,
  };
}

export async function saveNetworkPreferences(
  userId: string,
  preferences: NetworkPreferences,
  revision: number
) {
  const previous = await readNetworkPreferences(userId);
  const value = networkPreferencesSchema.parse(preferences);
  const { rows } = await rawQuery<{ revision: number }>(
    networkSql.save,
    [JSON.stringify(value), userId, revision],
    { revision: "pg/int4@1" }
  );
  if (!rows[0]) {
    throw new NetworkPreferenceConflictError(
      "Settings changed in another tab. Refresh and try again."
    );
  }
  const removed = previous.preferences.profiles.filter(
    (profile) => !value.profiles.some((next) => next.id === profile.id)
  );
  await Promise.all(
    removed.map((profile) => {
      const prefix = signalPrefix(userId, profile.id);
      return redis
        .del(`${prefix}:time`, `${prefix}:signals`, `${prefix}:dedupe`)
        .catch(() => 0);
    })
  );
  return { preferences: value, revision: rows[0].revision };
}

function networkSignalKey(
  kind: string,
  documentId: string,
  createdAt: number
): string {
  const period = ["downvote", "notInterested"].includes(kind)
    ? "active"
    : new Date(createdAt).toISOString().slice(0, 10);
  return createHash("sha256")
    .update(`${kind}:${documentId}:${period}`)
    .digest("hex");
}

export async function removeNetworkSignal(
  userId: string,
  profileId: string,
  kind: "downvote" | "notInterested",
  documentId: string
): Promise<boolean> {
  const prefix = signalPrefix(userId, profileId);
  const key = networkSignalKey(kind, documentId, Date.now());
  const result = await redis.eval(
    "local removed = redis.call('HDEL', KEYS[2], ARGV[1]); redis.call('ZREM', KEYS[1], ARGV[1]); redis.call('ZREM', KEYS[3], ARGV[1]); return removed",
    3,
    `${prefix}:time`,
    `${prefix}:signals`,
    `${prefix}:dedupe`,
    key
  );
  return result === 1;
}

export async function recordNetworkSignal(
  userId: string,
  profileId: string,
  signal: NetworkSignal,
  documentId: string,
  publicDocument = false,
  graphNamespace?: string
): Promise<boolean> {
  const parsed = networkSignalSchema.parse(signal);
  const prefix = signalPrefix(userId, profileId);
  const eventKey = networkSignalKey(parsed.kind, documentId, parsed.createdAt);
  const now = Date.now();
  const added = await redis.eval(
    RECORD,
    3,
    `${prefix}:time`,
    `${prefix}:signals`,
    `${prefix}:dedupe`,
    now,
    eventKey,
    JSON.stringify({ ...parsed, createdAt: now }),
    NETWORK_SIGNAL_RETENTION_SECONDS,
    now - NETWORK_SIGNAL_RETENTION_SECONDS * 1000
  );
  if (
    added === 1 &&
    publicDocument &&
    !["skip", "notInterested", "downvote"].includes(parsed.kind)
  ) {
    await recordSharedTopicRelations(
      parsed.tags,
      documentId,
      graphNamespace
    ).catch(() => {
      // Shared topic learning is best effort.
    });
  }
  return added === 1;
}

export async function getNetworkPersona(
  userId: string,
  requestedProfileId?: string,
  options: { graphNamespace?: string } = {}
) {
  const settings = await readNetworkPreferences(userId);
  const selected = settings.preferences.profiles.find(
    (profile) =>
      profile.id ===
      (requestedProfileId ?? settings.preferences.activeProfileId)
  );
  if (!selected) {
    throw new NetworkPreferenceConflictError(
      "Recommendation profile is no longer available"
    );
  }
  const prefix = signalPrefix(userId, selected.id);
  const saved = await redis.hvals(`${prefix}:signals`).catch(() => []);
  const now = new Date();
  const signals: ProfileSignal[] = saved.flatMap((value) => {
    let decoded: unknown;
    try {
      decoded = JSON.parse(value);
    } catch {
      return [];
    }
    const parsed = networkSignalSchema.safeParse(decoded);
    if (
      !parsed.success ||
      parsed.data.createdAt <
        now.getTime() - NETWORK_SIGNAL_RETENTION_SECONDS * 1000
    ) {
      return [];
    }
    return [{ ...parsed.data, createdAt: new Date(parsed.data.createdAt) }];
  });
  const seeds: ProfileSignal[] = selected.interests.flatMap((tag) =>
    Array.from({ length: 3 }, () => ({
      authorId: "",
      createdAt: now,
      kind: "search" as const,
      tags: [tag],
    }))
  );
  const graph = await loadSharedTopicGraph(
    [...selected.interests, ...signals.flatMap((signal) => signal.tags)],
    options.graphNamespace
  ).catch(() => null);
  let profile = buildUserProfile([...seeds, ...signals], {
    knowledgeGraph: graph ?? undefined,
    now,
  });
  if (
    selected.id === "default" &&
    !selected.interests.length &&
    !signals.length
  ) {
    profile = await getRecommendationProfile(userId);
  }
  const learned = buildUserProfile(signals, { now });
  const relatedInterests = Object.entries(profile.expandedEntityWeights ?? {})
    .filter(
      ([topic, weight]) => weight > 0 && !selected.interests.includes(topic)
    )
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([topic]) => topic);
  const avoidedTopics = Object.entries(learned.negativeTagWeights ?? {})
    .filter(([, weight]) => weight > 0)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 32)
    .map(([topic]) => topic);
  const learnedInterests = Object.entries(learned.tagWeights)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([topic]) => topic);
  // Native scoring uses native author IDs; remote identities keep their protocol prefix.
  const nativeAuthors = Object.fromEntries(
    Object.entries(profile.authorWeights)
      .filter(([id]) => id.startsWith("asm:"))
      .map(([id, weight]) => [id.slice(4), weight])
  );
  const result: UserProfile = {
    ...profile,
    authorWeights: { ...profile.authorWeights, ...nativeAuthors },
  };
  return {
    ...settings,
    persona: {
      avoidedTopics,
      learnedInterests,
      relatedInterests,
      signalCount: signals.length,
    },
    profile: result,
    selected,
    topicScope: await networkTopicScope(
      selected.interests,
      settings.preferences.avoidedTopics
    ),
  };
}

export async function getNetworkSettings(
  userId: string
): Promise<NetworkSettings> {
  const { preferences, revision, persona, selected } =
    await getNetworkPersona(userId);
  const [catalog, topicScope] = await Promise.all([
    networkTopicCatalog().catch(() => []),
    networkTopicScope(selected.interests, preferences.avoidedTopics, true),
  ]);
  return {
    catalog: [
      ...new Set(
        [
          ...catalog.map((entry) => entry.label),
          ...selected.interests,
          ...persona.relatedInterests,
          ...persona.learnedInterests,
        ].map(normalizeInterest)
      ),
    ],
    persona,
    preferences,
    revision,
    topicScope,
  };
}
