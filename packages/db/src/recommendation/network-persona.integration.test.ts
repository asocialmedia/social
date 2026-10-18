import { afterAll, beforeAll, expect, test } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";

import prisma, { closePrisma } from "../prisma";
import { redis } from "../redis";
import {
  getNetworkPersona,
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

afterAll(async () => {
  const graphKeys = await redis.keys(`${namespace}*`);
  const signalKeys = await Promise.all(
    ids.map((id) => redis.keys(`rec:network:v1:{${id}:*`))
  );
  const keys = [...graphKeys, ...signalKeys.flat()];
  if (keys.length) {
    await redis.del(...keys);
  }
  await prisma.orm.public.Users.where((user) => user.id.in(ids)).delete();
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
