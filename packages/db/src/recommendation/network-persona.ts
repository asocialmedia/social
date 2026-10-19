import { createHash } from "node:crypto";

import {
  BoundedReadQueue,
  SharedReadCache,
  createRedisReadStore,
  defaultNetworkPreferences,
  networkPreferencesSchema,
  normalizeInterest,
} from "@asm/protocols/discovery";
import type {
  NetworkPreferences,
  NetworkSettings,
} from "@asm/protocols/discovery";
import { and, or } from "@prisma/orm-postgres/orm-client";
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
  network: ["save", "candidates", "pagedCandidates", "creators"],
}).network;
export const NETWORK_SIGNAL_RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const NETWORK_FEED_TTL_SECONDS = 10 * 60;
const kinds = [
  "amplify",
  "downvote",
  "bookmark",
  "follow",
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
local generation = redis.call('GET', KEYS[4])
if generation and generation ~= ARGV[6] then return 0 end
redis.call('SET', KEYS[4], ARGV[6], 'EX', ARGV[4])
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

function signalPrefix(
  userId: string,
  profileId: string,
  resetAt?: number
): string {
  return `rec:network:v1:{${userId}:${profileId}}${resetAt ? `:reset:${resetAt}` : ""}`;
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
  revision: number,
  resetProfileId?: string
) {
  const previous = await readNetworkPreferences(userId);
  const value = networkPreferencesSchema.parse(preferences);
  value.profiles = value.profiles.map((profile) => {
    const previousProfile = previous.preferences.profiles.find(
      (entry) => entry.id === profile.id
    );
    const activityResetAt =
      profile.id === resetProfileId
        ? Math.max(Date.now(), (previousProfile?.activityResetAt ?? 0) + 1)
        : previousProfile?.activityResetAt;
    return { ...profile, activityResetAt };
  });
  // Freeze pre-profile activity before a second profile can write durable engagements.
  const legacyBaseline =
    previous.preferences.profiles.length === 1 && value.profiles.length > 1
      ? await getRecommendationProfile(userId).catch(() => null)
      : null;
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
  if (legacyBaseline) {
    await redis
      .set(
        `rec:legacy-persona:v1:${userId}`,
        JSON.stringify({ at: Date.now(), profile: legacyBaseline }),
        "EX",
        NETWORK_SIGNAL_RETENTION_SECONDS,
        "NX"
      )
      .catch(() => null);
  }
  const removed = previous.preferences.profiles.filter(
    (profile) => !value.profiles.some((next) => next.id === profile.id)
  );
  await Promise.all(
    removed.map((profile) => {
      const prefix = signalPrefix(userId, profile.id, profile.activityResetAt);
      return redis
        .del(`${prefix}:time`, `${prefix}:signals`, `${prefix}:dedupe`)
        .catch(() => 0);
    })
  );
  await redis
    .set(
      `rec:suggestions:version:${userId}`,
      crypto.randomUUID(),
      "EX",
      NETWORK_SIGNAL_RETENTION_SECONDS
    )
    .catch(() => null);
  return { preferences: value, revision: rows[0].revision };
}

export async function clearNetworkActivity(
  userId: string,
  profileId: string,
  revision: number
) {
  const previous = await readNetworkPreferences(userId);
  const profile = previous.preferences.profiles.find(
    (entry) => entry.id === profileId
  );
  if (!profile) {
    throw new NetworkPreferenceConflictError(
      "This profile is no longer available."
    );
  }
  const result = await saveNetworkPreferences(
    userId,
    previous.preferences,
    revision,
    profileId
  );
  const resetAt = result.preferences.profiles.find(
    (entry) => entry.id === profileId
  )?.activityResetAt;
  const prefix = signalPrefix(userId, profileId, profile.activityResetAt);
  await redis
    .multi()
    .set(
      `${signalPrefix(userId, profileId)}:generation`,
      String(resetAt),
      "EX",
      NETWORK_SIGNAL_RETENTION_SECONDS
    )
    .del(`${prefix}:time`, `${prefix}:signals`, `${prefix}:dedupe`)
    .exec();
  return result;
}

function networkSignalKey(
  kind: string,
  documentId: string,
  createdAt: number
): string {
  const period = ["downvote", "notInterested", "follow"].includes(kind)
    ? "active"
    : new Date(createdAt).toISOString().slice(0, 10);
  return createHash("sha256")
    .update(`${kind}:${documentId}:${period}`)
    .digest("hex");
}

export async function removeNetworkSignal(
  userId: string,
  profileId: string,
  kind: "downvote" | "notInterested" | "follow",
  documentId: string
): Promise<boolean> {
  const settings = await readNetworkPreferences(userId);
  const profile = settings.preferences.profiles.find(
    (entry) => entry.id === profileId
  );
  if (!profile) {
    return false;
  }
  const prefix = signalPrefix(userId, profileId, profile.activityResetAt);
  const key = networkSignalKey(kind, documentId, Date.now());
  const result = await redis.eval(
    "local removed = redis.call('HDEL', KEYS[2], ARGV[1]); redis.call('ZREM', KEYS[1], ARGV[1]); redis.call('ZREM', KEYS[3], ARGV[1]); return removed",
    3,
    `${prefix}:time`,
    `${prefix}:signals`,
    `${prefix}:dedupe`,
    key
  );
  if (result === 1) {
    await redis
      .set(
        `rec:suggestions:version:${userId}`,
        crypto.randomUUID(),
        "EX",
        NETWORK_SIGNAL_RETENTION_SECONDS
      )
      .catch(() => null);
  }
  return result === 1;
}

export async function recordNetworkSignal(
  userId: string,
  profileId: string,
  signal: NetworkSignal,
  documentId: string,
  publicDocument = false,
  graphNamespace?: string,
  expectedRevision?: number
): Promise<boolean> {
  const parsed = networkSignalSchema.parse(signal);
  const settings = await readNetworkPreferences(userId);
  const profile = settings.preferences.profiles.find(
    (entry) => entry.id === profileId
  );
  if (
    !profile ||
    (expectedRevision !== undefined &&
      expectedRevision !== settings.revision) ||
    parsed.createdAt < (profile.activityResetAt ?? 0)
  ) {
    return false;
  }
  const prefix = signalPrefix(userId, profileId, profile.activityResetAt);
  const eventKey = networkSignalKey(parsed.kind, documentId, parsed.createdAt);
  const now = Date.now();
  const added = await redis.eval(
    RECORD,
    4,
    `${prefix}:time`,
    `${prefix}:signals`,
    `${prefix}:dedupe`,
    `${signalPrefix(userId, profileId)}:generation`,
    now,
    eventKey,
    JSON.stringify({ ...parsed, createdAt: now }),
    NETWORK_SIGNAL_RETENTION_SECONDS,
    now - NETWORK_SIGNAL_RETENTION_SECONDS * 1000,
    String(profile.activityResetAt ?? 0)
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
  if (added === 1) {
    await redis
      .set(
        `rec:suggestions:version:${userId}`,
        crypto.randomUUID(),
        "EX",
        NETWORK_SIGNAL_RETENTION_SECONDS
      )
      .catch(() => null);
  }
  return added === 1;
}

const weightsSchema = z.record(z.string(), z.number().finite());
const personaSnapshotSchema = z.object({
  persona: z.object({
    avoidedTopics: z.array(z.string()),
    learnedInterests: z.array(z.string()),
    relatedInterests: z.array(z.string()),
    signalCount: z.number(),
  }),
  profile: z.object({
    authorWeights: weightsSchema,
    embeddingModel: z.string().optional(),
    expandedEntityWeights: weightsSchema.optional(),
    formatAffinities: z
      .object({
        audio: z.number(),
        image: z.number(),
        text: z.number(),
        video: z.number(),
      })
      .optional(),
    negativeAuthorWeights: weightsSchema.optional(),
    negativeTagWeights: weightsSchema.optional(),
    sessionTagWeights: weightsSchema.optional(),
    signalCount: z.number().optional(),
    summary: z
      .object({
        dominantTopic: z.string(),
        preferredFormat: z.enum([
          "audio",
          "image",
          "text",
          "video",
          "balanced",
        ]),
        topTags: z.array(z.string()),
      })
      .optional(),
    tagWeights: weightsSchema,
    tasteVector: z.array(z.number()).optional(),
    topicAffinities: weightsSchema.optional(),
  }),
});
const personaCache = new SharedReadCache({
  deadlineMs: 15_000,
  parse: (value) => personaSnapshotSchema.parse(value),
  queue: new BoundedReadQueue({
    concurrency: 4,
    maxQueued: 64,
    maxWaitMs: 5000,
  }),
  store: createRedisReadStore(redis),
  ttlMs: 30_000,
});

export function networkPersonaCacheStats() {
  return personaCache.stats;
}

function strongestWeights(
  first: Record<string, number> = {},
  second: Record<string, number> = {}
) {
  return Object.fromEntries(
    [...new Set([...Object.keys(first), ...Object.keys(second)])].map((key) => [
      key,
      Math.max(first[key] ?? 0, second[key] ?? 0),
    ])
  );
}

// Both spellings address the same ASM author; protocol identities remain namespaced.
function nativeAuthorAliases(weights: Record<string, number> = {}) {
  const result = { ...weights };
  for (const [id, weight] of Object.entries(weights)) {
    if (id.startsWith("bluesky:")) {
      continue;
    }
    const nativeId = id.startsWith("asm:") ? id.slice(4) : id;
    const strongest = Math.max(
      weight,
      weights[nativeId] ?? 0,
      weights[`asm:${nativeId}`] ?? 0
    );
    result[nativeId] = strongest;
    result[`asm:${nativeId}`] = strongest;
  }
  return result;
}

const weakPrior = (weights: Record<string, number> = {}) =>
  Object.fromEntries(
    Object.entries(weights).map(([id, weight]) => [id, weight * 0.1])
  );

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
  const version = await redis
    .get(`rec:suggestions:version:${userId}`)
    .catch(() => null);
  const key = `rec:persona:v3:{${createHash("sha256")
    .update(
      JSON.stringify([
        userId,
        selected.id,
        settings.revision,
        version,
        options.graphNamespace ?? "",
      ])
    )
    .digest("hex")}}`;
  const snapshot = await personaCache.read(key, () =>
    buildNetworkPersona(
      userId,
      selected,
      options,
      settings.preferences.profiles.length === 1
    )
  );
  return {
    ...settings,
    ...snapshot,
    selected,
    topicScope: await networkTopicScope(
      selected.interests,
      settings.preferences.avoidedTopics
    ),
  };
}

async function buildNetworkPersona(
  userId: string,
  selected: NetworkPreferences["profiles"][number],
  options: { graphNamespace?: string },
  allowLiveLegacy: boolean
) {
  const prefix = signalPrefix(userId, selected.id, selected.activityResetAt);
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
      kind: "interest" as const,
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
  if (selected.id === "default" && !selected.activityResetAt) {
    const savedBaseline = await redis
      .get(`rec:legacy-persona:v1:${userId}`)
      .catch(() => null);
    let base: UserProfile = { authorWeights: {}, tagWeights: {} };
    let decodedBaseline: unknown;
    try {
      decodedBaseline = JSON.parse(savedBaseline ?? "null");
    } catch {
      decodedBaseline = null;
    }
    const baseline = z
      .object({ at: z.number(), profile: personaSnapshotSchema.shape.profile })
      .safeParse(decodedBaseline);
    if (baseline.success) {
      const decay =
        0.5 ** (Math.max(0, Date.now() - baseline.data.at) / (7 * 86_400_000));
      const decayed = (weights: Record<string, number> = {}) =>
        Object.fromEntries(
          Object.entries(weights).map(([key, weight]) => [key, weight * decay])
        );
      base = {
        ...baseline.data.profile,
        authorWeights: decayed(baseline.data.profile.authorWeights),
        expandedEntityWeights: decayed(
          baseline.data.profile.expandedEntityWeights
        ),
        sessionTagWeights: {},
        tagWeights: decayed(baseline.data.profile.tagWeights),
        topicAffinities: decayed(baseline.data.profile.topicAffinities),
      };
    } else if (allowLiveLegacy) {
      base = await getRecommendationProfile(userId);
    }

    if (selected.interests.length) {
      base = {
        ...base,
        expandedEntityWeights: weakPrior(base.expandedEntityWeights),
        tagWeights: weakPrior(base.tagWeights),
        topicAffinities: weakPrior(base.topicAffinities),
      };
    }
    // Existing durable activity remains part of the default persona without counting the same signal twice.
    profile = {
      ...base,
      ...profile,
      authorWeights: strongestWeights(
        base.authorWeights,
        profile.authorWeights
      ),
      embeddingModel: profile.embeddingModel ?? base.embeddingModel,
      expandedEntityWeights: strongestWeights(
        base.expandedEntityWeights,
        profile.expandedEntityWeights
      ),
      formatAffinities: {
        audio: Math.max(
          base.formatAffinities?.audio ?? 0,
          profile.formatAffinities?.audio ?? 0
        ),
        image: Math.max(
          base.formatAffinities?.image ?? 0,
          profile.formatAffinities?.image ?? 0
        ),
        text: Math.max(
          base.formatAffinities?.text ?? 0,
          profile.formatAffinities?.text ?? 0
        ),
        video: Math.max(
          base.formatAffinities?.video ?? 0,
          profile.formatAffinities?.video ?? 0
        ),
      },
      negativeAuthorWeights: strongestWeights(
        base.negativeAuthorWeights,
        profile.negativeAuthorWeights
      ),
      negativeTagWeights: strongestWeights(
        base.negativeTagWeights,
        profile.negativeTagWeights
      ),
      sessionTagWeights: strongestWeights(
        base.sessionTagWeights,
        profile.sessionTagWeights
      ),
      tagWeights: strongestWeights(base.tagWeights, profile.tagWeights),
      tasteVector: profile.tasteVector?.length
        ? profile.tasteVector
        : base.tasteVector,
      topicAffinities: strongestWeights(
        base.topicAffinities,
        profile.topicAffinities
      ),
    };
  }
  const learned = buildUserProfile(signals, { now });
  const relatedInterests = Object.entries(profile.expandedEntityWeights ?? {})
    .filter(
      ([topic, weight]) => weight > 0 && !selected.interests.includes(topic)
    )
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([topic]) => topic);
  const deliberateAvoidance = buildUserProfile(
    signals.filter(
      (signal) => signal.kind === "downvote" || signal.kind === "notInterested"
    ),
    { now }
  );
  const avoidedTopics = Object.entries(
    deliberateAvoidance.negativeTagWeights ?? {}
  )
    .filter(([, weight]) => weight > 0)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 32)
    .map(([topic]) => topic);
  const learnedInterests = Object.entries(learned.tagWeights)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([topic]) => topic);
  // Follows provide a weak prior from public authored content, never another person's private interests or activity.
  const follows = await prisma.orm.public.Follows.select("followingId")
    .where((follow) =>
      and(
        follow.followerId.eq(userId),
        follow.following.some((person) => person.banned.eq(false))
      )
    )
    .limit(40)
    .all();
  const blocks = await prisma.orm.public.Blocks.select("blockerId", "blockedId")
    .where((block) =>
      or(block.blockerId.eq(userId), block.blockedId.eq(userId))
    )
    .all();
  const blocked = new Set(
    blocks.map((block) =>
      block.blockerId === userId ? block.blockedId : block.blockerId
    )
  );
  const followedIds = follows
    .map((follow) => follow.followingId)
    .filter((id) => !blocked.has(id));
  const publicPosts = followedIds.length
    ? await prisma.orm.public.Posts.select("userId", "semanticTags")
        .where((post) =>
          and(
            post.userId.in(followedIds),
            post.communityId.isNull(),
            post.moderated.eq(false),
            post.explicitContent.eq(false)
          )
        )
        .orderBy((post) => post.createdAt.desc())
        .limit(120)
        .all()
    : [];
  const externalFollows = await prisma.orm.public.ExternalFollows.select(
    "authorDid"
  )
    .where((follow) =>
      and(
        follow.userId.eq(userId),
        follow.author.some((author) => author.status.eq("active"))
      )
    )
    .limit(80)
    .all();
  const publicTopics = new Map<string, Set<string>>();
  for (const post of publicPosts) {
    const topics = publicTopics.get(post.userId) ?? new Set<string>();
    for (const tag of post.semanticTags ?? []) {
      if (topics.size < 12) {
        topics.add(tag);
      }
    }
    publicTopics.set(post.userId, topics);
  }
  const followedProfile = buildUserProfile(
    followedIds.map((authorId) => ({
      authorId: `asm:${authorId}`,
      createdAt: now,
      kind: "interest",
      tags: [...(publicTopics.get(authorId) ?? [])],
    })),
    { now }
  );
  const result: UserProfile = {
    ...profile,
    authorWeights: nativeAuthorAliases(
      strongestWeights(profile.authorWeights, {
        ...weakPrior(followedProfile.authorWeights),
        ...Object.fromEntries(
          externalFollows.map((follow) => [`bluesky:${follow.authorDid}`, 0.1])
        ),
      })
    ),
    negativeAuthorWeights: nativeAuthorAliases(profile.negativeAuthorWeights),
    tagWeights: strongestWeights(
      profile.tagWeights,
      weakPrior(followedProfile.tagWeights)
    ),
  };
  return {
    persona: {
      avoidedTopics,
      learnedInterests,
      relatedInterests,
      signalCount: signals.length,
    },
    profile: result,
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
