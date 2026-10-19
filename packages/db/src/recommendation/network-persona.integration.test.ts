import { afterAll, beforeAll, expect, test } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";

import prisma, { closePrisma } from "../prisma";
import { redis } from "../redis";
import {
  getNetworkPersona,
  networkPersonaCacheStats,
  clearNetworkActivity,
  readNetworkPreferences,
  recordNetworkSignal,
  removeNetworkSignal,
  saveNetworkPreferences,
  NETWORK_SIGNAL_RETENTION_SECONDS,
  NetworkPreferenceConflictError,
} from "./network-persona";
import { loadSharedTopicGraph } from "./shared-topic-graph";

const ids = Array.from({ length: 3 }, () => crypto.randomUUID());
const [animeId = "", techId = "", gardenId = ""] = ids;
const softwareProfile = crypto.randomUUID();
const namespace = `test:network-graph:${crypto.randomUUID()}:`;
const signal = {
  authorId: "bluesky:did:plc:fixture",
  createdAt: Date.now(),
  hasImage: true,
  kind: "bookmark" as const,
  tags: ["anime", "figurines", "3d art"],
};
const prefix = (id: string, profile = "default") =>
  `rec:network:v1:{${id}:${profile}}`;

beforeAll(async () => {
  await Promise.all(
    ids.map((id) =>
      prisma.orm.public.Users.create({
        displayName: `Network fixture ${id}`,
        id,
        username: `network-fixture-${id}`,
      })
    )
  );
  await Promise.all(
    [
      [animeId, ["anime", "manga", "comics"]],
      [techId, ["software", "programming", "artificial intelligence"]],
      [gardenId, ["orchids", "botany"]],
    ].map(async ([id, topics]) => {
      if (typeof id !== "string" || !Array.isArray(topics)) {
        throw new TypeError("Invalid fixture");
      }
      const preferences = {
        ...defaultNetworkPreferences(),
        profiles: [
          { id: "default", interests: topics, name: "Everyday" },
          { id: softwareProfile, interests: ["software"], name: "Software" },
        ],
      };
      await saveNetworkPreferences(id, preferences, 0);
    })
  );
});

test("clearing one profile removes learning, fences old receipts and preserves interests and other profiles", async () => {
  const id = crypto.randomUUID();
  await prisma.orm.public.Users.create({
    displayName: "Clear activity fixture",
    id,
    username: `activity-${id}`,
  });
  try {
    const settings = await saveNetworkPreferences(
      id,
      {
        ...defaultNetworkPreferences(),
        profiles: [
          { id: "default", interests: ["software"], name: "Work" },
          { id: softwareProfile, interests: ["art"], name: "Art" },
        ],
      },
      0
    );
    await recordNetworkSignal(
      id,
      "default",
      { ...signal, createdAt: Date.now() },
      "one"
    );
    await recordNetworkSignal(
      id,
      softwareProfile,
      { ...signal, createdAt: Date.now() },
      "two"
    );
    const cleared = await clearNetworkActivity(
      id,
      "default",
      settings.revision
    );
    expect(cleared.revision).toBe(settings.revision + 1);
    expect(cleared.preferences.profiles[0]?.interests).toEqual(["software"]);
    expect(await redis.exists(`${prefix(id)}:signals`)).toBe(0);
    const clearedPersona = await getNetworkPersona(id);
    const otherPersona = await getNetworkPersona(id, softwareProfile);
    expect(clearedPersona.persona.signalCount).toBe(0);
    expect(otherPersona.persona.signalCount).toBe(1);
    expect(
      await recordNetworkSignal(
        id,
        "default",
        { ...signal, createdAt: Date.now() },
        "old-receipt",
        false,
        undefined,
        settings.revision
      )
    ).toBe(false);
    expect(
      await recordNetworkSignal(
        id,
        "default",
        { ...signal, createdAt: Date.now() },
        "new-receipt",
        false,
        undefined,
        cleared.revision
      )
    ).toBe(true);
    const freshPersona = await getNetworkPersona(id);
    expect(freshPersona.persona.signalCount).toBe(1);
    const resaved = await saveNetworkPreferences(
      id,
      {
        ...cleared.preferences,
        profiles: cleared.preferences.profiles.map((profile) => ({
          ...profile,
          activityResetAt: undefined,
        })),
      },
      cleared.revision
    );
    expect(resaved.preferences.profiles[0]?.activityResetAt).toBe(
      cleared.preferences.profiles[0]?.activityResetAt
    );
    await expect(
      clearNetworkActivity(id, "default", settings.revision)
    ).rejects.toBeInstanceOf(NetworkPreferenceConflictError);
  } finally {
    const keys = await redis.keys(`rec:network:v1:{${id}:*`);
    if (keys.length) {
      await redis.del(...keys);
    }
    await prisma.orm.public.Users.where({ id }).deleteAndCount();
  }
});

afterAll(async () => {
  const graphKeys = await redis.keys(`${namespace}*`);
  const signalKeys = await Promise.all(
    ids.map((id) => redis.keys(`rec:network:v1:{${id}:*`))
  );
  const keys = [...graphKeys, ...signalKeys.flat()];
  if (keys.length) {
    await redis.del(...keys);
  }
  await prisma.orm.public.Users.where((user) =>
    user.id.in(ids)
  ).deleteAndCount();
  await closePrisma();
  redis.disconnect();
});

test("three durable personas start with independent declared interests", async () => {
  const [anime, tech, garden] = await Promise.all(
    ids.map((id) =>
      getNetworkPersona(id, "default", { graphNamespace: namespace })
    )
  );
  expect(anime?.profile.tagWeights.anime).toBeGreaterThan(0);
  expect(anime?.profile.tagWeights.software).toBeUndefined();
  expect(tech?.profile.tagWeights.software).toBeGreaterThan(0);
  expect(garden?.profile.tagWeights.orchids).toBeGreaterThan(0);
  const settings = await readNetworkPreferences(animeId);
  expect(settings.preferences.showExplicitContent).toBe(false);
});

test("concurrent settings saves cannot silently overwrite a newer choice", async () => {
  const current = await readNetworkPreferences(gardenId);
  const saved = await Promise.allSettled([
    saveNetworkPreferences(
      gardenId,
      { ...current.preferences, language: "ja" },
      current.revision
    ),
    saveNetworkPreferences(
      gardenId,
      { ...current.preferences, region: "IN" },
      current.revision
    ),
  ]);
  expect(saved.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
  const rejected = saved.find((entry) => entry.status === "rejected");
  expect(
    rejected?.status === "rejected" &&
      rejected.reason instanceof NetworkPreferenceConflictError
  ).toBe(true);
});

test("learning deduplicates, expands observed relationships and stays isolated by account and profile", async () => {
  const accepted = await Promise.all(
    Array.from({ length: 20 }, () =>
      recordNetworkSignal(
        animeId,
        "default",
        signal,
        "bluesky:fixture-figurines",
        true,
        namespace
      )
    )
  );
  expect(accepted.filter(Boolean)).toHaveLength(1);
  const anime = await getNetworkPersona(animeId, "default", {
    graphNamespace: namespace,
  });
  expect(anime.persona.learnedInterests).toContain("figurines");
  expect(anime.profile.expandedEntityWeights?.["3d-art"]).toBeGreaterThan(0);
  const otherProfile = await getNetworkPersona(animeId, softwareProfile, {
    graphNamespace: namespace,
  });
  expect(otherProfile.persona.signalCount).toBe(0);
  const tech = await getNetworkPersona(techId, "default", {
    graphNamespace: namespace,
  });
  expect(tech.persona.signalCount).toBe(0);
  expect(
    await prisma.orm.public.ExternalPosts.where({
      uri: "bluesky:fixture-figurines",
    }).first()
  ).toBeNull();
});

test("private content can shape its reader without entering the shared topic graph", async () => {
  await recordNetworkSignal(
    techId,
    "default",
    { ...signal, tags: ["software", "private-company-roadmap"] },
    "asm:private-fixture",
    false,
    namespace
  );
  const graph = await loadSharedTopicGraph(["software"], namespace);
  expect(
    graph.spreadingActivation({ software: 1 })["private-company-roadmap"]
  ).toBeUndefined();
  const tech = await getNetworkPersona(techId, "default", {
    graphNamespace: namespace,
  });
  expect(tech.persona.learnedInterests).toContain("private-company-roadmap");
});

test("learning has bounded records and TTLs, ignores corrupt or expired values, and leaves chosen interests intact", async () => {
  await Promise.all(
    Array.from({ length: 510 }, (_, index) =>
      recordNetworkSignal(
        gardenId,
        "default",
        { ...signal, tags: ["orchids"] },
        `fixture:${index}`
      )
    )
  );
  const key = prefix(gardenId);
  expect(await redis.hlen(`${key}:signals`)).toBe(500);
  expect(await redis.zcard(`${key}:time`)).toBe(500);
  expect(await redis.ttl(`${key}:signals`)).toBeGreaterThan(
    NETWORK_SIGNAL_RETENTION_SECONDS - 60
  );
  await redis.hset(
    `${key}:signals`,
    "expired",
    JSON.stringify({
      ...signal,
      createdAt: Date.now() - (NETWORK_SIGNAL_RETENTION_SECONDS + 1) * 1000,
      tags: ["expired-interest"],
    }),
    "corrupt",
    "broken JSON"
  );
  const persona = await getNetworkPersona(gardenId, "default", {
    graphNamespace: namespace,
  });
  expect(persona.persona.signalCount).toBe(500);
  expect(persona.profile.tagWeights["expired-interest"]).toBeUndefined();
  expect(persona.selected.interests).toContain("orchids");
});

test("deleting a profile removes its recent learning and cannot select another account's profile", async () => {
  await recordNetworkSignal(
    animeId,
    softwareProfile,
    { ...signal, tags: ["software"] },
    "fixture:software"
  );
  const current = await readNetworkPreferences(animeId);
  await saveNetworkPreferences(
    animeId,
    {
      ...current.preferences,
      profiles: current.preferences.profiles.filter(
        (profile) => profile.id !== softwareProfile
      ),
    },
    current.revision
  );
  expect(
    await redis.exists(`${prefix(animeId, softwareProfile)}:signals`)
  ).toBe(0);
  await expect(getNetworkPersona(animeId, softwareProfile)).rejects.toThrow();
});

test("explicit exclusions persist independently of learning and downvote undo removes the learned penalty", async () => {
  const settings = await readNetworkPreferences(techId);
  await saveNetworkPreferences(
    techId,
    { ...settings.preferences, avoidedTopics: ["furry"] },
    settings.revision
  );
  await recordNetworkSignal(
    techId,
    "default",
    { ...signal, kind: "downvote", tags: ["crypto"] },
    "asm:negative-fixture",
    true,
    namespace
  );
  let persona = await getNetworkPersona(techId, "default", {
    graphNamespace: namespace,
  });
  expect(persona.preferences.avoidedTopics).toEqual(["furry"]);
  expect(persona.persona.avoidedTopics).toContain("crypto");
  expect(persona.profile.negativeTagWeights?.crypto).toBeGreaterThan(0);
  const other = await getNetworkPersona(techId, softwareProfile, {
    graphNamespace: namespace,
  });
  expect(other.persona.avoidedTopics).not.toContain("crypto");
  await removeNetworkSignal(
    techId,
    "default",
    "downvote",
    "asm:negative-fixture"
  );
  persona = await getNetworkPersona(techId, "default", {
    graphNamespace: namespace,
  });
  expect(persona.persona.avoidedTopics).not.toContain("crypto");
  expect(persona.preferences.avoidedTopics).toEqual(["furry"]);
});

test("concurrent recommendation consumers share one persona build and learning invalidates it", async () => {
  const graphNamespace = `test:persona-cache:${crypto.randomUUID()}:`;
  const before = networkPersonaCacheStats();
  {
    const values = await Promise.all(
      Array.from({ length: 20 }, () =>
        getNetworkPersona(gardenId, "default", { graphNamespace })
      )
    );
    expect(
      networkPersonaCacheStats().coalesced - before.coalesced
    ).toBeGreaterThanOrEqual(19);
    expect(
      values.every(
        (value) =>
          JSON.stringify(value.profile) === JSON.stringify(values[0]?.profile)
      )
    ).toBe(true);
    await recordNetworkSignal(
      gardenId,
      "default",
      {
        authorId: "asm:cache-author",
        createdAt: Date.now(),
        hasVideo: true,
        kind: "bookmark",
        tags: ["cinema"],
      },
      crypto.randomUUID()
    );
    const learned = await getNetworkPersona(gardenId, "default", {
      graphNamespace,
    });

    expect(learned.profile.authorWeights["cache-author"]).toBeGreaterThan(0);
    expect(learned.profile.authorWeights["asm:cache-author"]).toBe(
      learned.profile.authorWeights["cache-author"]
    );
    expect(learned.persona.learnedInterests).toContain("cinema");
    expect(learned.profile.formatAffinities?.video).toBeGreaterThan(0);
  }
});

test("durable engagement in a second profile never leaks into the default profile's legacy history", async () => {
  const id = crypto.randomUUID();
  const postId = crypto.randomUUID();
  const topic = `profileisolation${crypto.randomUUID().replaceAll("-", "")}`;
  await prisma.orm.public.Users.create({
    displayName: "Profile isolation",
    id,
    username: `isolation-${id}`,
  });
  try {
    await saveNetworkPreferences(
      id,
      {
        ...defaultNetworkPreferences(),
        profiles: [
          { id: "default", interests: [], name: "Everyday" },
          { id: softwareProfile, interests: [], name: "Work" },
        ],
      },
      0
    );
    await prisma.orm.public.Posts.create({
      content: topic,
      id: postId,
      semanticTags: [topic],
      userId: techId,
    });
    await prisma.orm.public.Votes.create({ postId, userId: id, value: 1 });
    await recordNetworkSignal(
      id,
      softwareProfile,
      {
        authorId: `asm:${techId}`,
        createdAt: Date.now(),
        kind: "amplify",
        tags: [topic],
      },
      `asm:${postId}`
    );
    const work = await getNetworkPersona(id, softwareProfile);
    const everyday = await getNetworkPersona(id, "default");
    expect(work.profile.tagWeights[topic]).toBeGreaterThan(0);
    expect(everyday.profile.tagWeights[topic] ?? 0).toBe(0);
    expect(everyday.persona.learnedInterests).not.toContain(topic);
  } finally {
    await prisma.orm.public.Posts.where({ id: postId }).deleteAndCount();
    await prisma.orm.public.Users.where({ id }).deleteAndCount();
    await redis.del(`rec:legacy-persona:v1:${id}`);
  }
});
