import { createHash } from "node:crypto";

import {
  createKnowledgeTopicProvider,
  networkTopicPageSchema,
  normalizeInterest,
} from "@asm/protocols/discovery";
import type {
  NetworkTopic,
  NetworkTopicPage,
  NetworkTopicScope,
} from "@asm/protocols/discovery";

import source from "../../sql/recommendation/topics.sql" with { type: "text" };
import { rawQuery } from "../messages/infrastructure/raw-sql";
import { readSqlBundle } from "../messages/infrastructure/sql-template";
import { redis } from "../redis";
import { networkContentTopics } from "./network-features";

const sql = readSqlBundle(source, { topics: ["catalog"] }).topics;
const provider = createKnowledgeTopicProvider();
const pending = new Map<string, Promise<NetworkTopicPage>>();
const cachePrefix = "rec:topic-taxonomy:v3:";
const scopeMemo = new Map<string, { at: number; scope: NetworkTopicScope }>();

function cacheKey(kind: string, value: string) {
  return `${cachePrefix}${kind}:${createHash("sha256")
    .update(normalizeInterest(value.replace(/^Category:/u, "")))
    .digest("hex")}`;
}

async function cachedPage(key: string): Promise<NetworkTopicPage | null> {
  try {
    const value = await redis.get(key);
    const parsed = networkTopicPageSchema.safeParse(
      value ? JSON.parse(value) : null
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function knowledgeTopicPage(
  options: {
    query?: string;
    parent?: string;
    cachedOnly?: boolean;
    signal?: AbortSignal;
  } = {}
): Promise<NetworkTopicPage> {
  const query = options.query?.trim() ?? "";
  const parent = options.parent?.trim();
  const key = cacheKey(query ? "search" : "browse", query || parent || "root");
  const cached = await cachedPage(key);
  if (cached) {
    return cached;
  }
  if (options.cachedOnly) {
    return { aliases: [], items: [], parent: parent ?? null, partial: true };
  }
  const existing = pending.get(key);
  if (existing) {
    return existing;
  }
  const work = (async () => {
    const signal = options.signal ?? AbortSignal.timeout(6000);
    const page = query
      ? await provider.search(query, signal)
      : await provider.browse(parent, signal);
    await redis
      .set(key, JSON.stringify(page), "EX", page.partial ? 300 : 86_400)
      .catch(() => {
        // Taxonomy reads remain usable through a cache outage.
      });
    if (!query) {
      scopeMemo.clear();
    }
    return page;
  })();
  pending.set(key, work);
  try {
    return await work;
  } finally {
    pending.delete(key);
  }
}

export async function networkTopicCatalog(query = ""): Promise<NetworkTopic[]> {
  const [{ rows }, nodes] = await Promise.all([
    rawQuery<{ topic: string }>(sql.catalog, [query], { topic: "pg/text@1" }),
    redis.zrevrange("rec:topic-graph:v1:nodes", 0, 199).catch(() => []),
  ]);
  const observed = nodes.flatMap((key) => {
    const [, encoded] = key.split(":neighbors:");
    if (!encoded) {
      return [];
    }
    try {
      const label = decodeURIComponent(encoded).replaceAll("-", " ");
      return label.length >= 2 &&
        label.length <= 64 &&
        label.toLowerCase().includes(normalizeInterest(query))
        ? [
            {
              aliases: [],
              id: `observed:${label}`,
              label,
              source: "observed" as const,
            },
          ]
        : [];
    } catch {
      return [];
    }
  });
  const native: NetworkTopic[] = rows.map(({ topic }) => ({
    aliases: [],
    id: `asm:${topic}`,
    label: topic,
    source: "asm",
  }));
  return [
    ...new Map(
      [...native, ...observed].map((entry) => [
        normalizeInterest(entry.label),
        entry,
      ])
    ).values(),
  ].slice(0, 40);
}

export async function networkTopicScope(
  interests: readonly string[],
  avoidedTopics: readonly string[],
  refresh = false
): Promise<NetworkTopicScope> {
  const memoKey = JSON.stringify([interests, avoidedTopics]);
  const previous = scopeMemo.get(memoKey);
  if (!refresh && previous && Date.now() - previous.at < 30_000) {
    return previous.scope;
  }
  const roots = [...new Set([...interests, ...avoidedTopics])];
  const expansions = new Map<string, NetworkTopicPage>();
  // Each request explores one level only. Existing child caches supply deeper evidence without recursively issuing upstream reads.
  for (let index = 0; index < roots.length; index += 4) {
    // oxlint-disable-next-line no-await-in-loop -- batches bound concurrent provider requests.
    const pages = await Promise.all(
      roots.slice(index, index + 4).map(async (root) => ({
        page: await knowledgeTopicPage({
          cachedOnly: !refresh || index >= 4,
          parent: root,
        }).catch(() => ({
          aliases: [],
          items: [],
          parent: root,
          partial: true,
        })),
        root,
      }))
    );
    for (const { root, page } of pages) {
      expansions.set(root, page);
    }
  }
  const termsFor = async (root: string, descendants: boolean) => {
    const page = expansions.get(root);
    const terms = [root, ...(page?.aliases ?? [])];
    if (descendants) {
      terms.push(...(page?.relatedTerms ?? []));
      let frontier = page?.items.slice(0, 10) ?? [];
      const visited = new Set([normalizeInterest(root)]);
      for (
        let depth = 0;
        depth < 10 && frontier.length && visited.size < 160;
        depth += 1
      ) {
        const current = frontier
          .filter((child) => !visited.has(normalizeInterest(child.label)))
          .slice(0, 160 - visited.size);
        for (const child of current) {
          visited.add(normalizeInterest(child.label));
          terms.push(child.label, ...child.aliases);
        }
        // oxlint-disable-next-line no-await-in-loop -- descendants depend on the current frontier.
        const nested = await Promise.all(
          current.map((child) =>
            knowledgeTopicPage({
              cachedOnly: true,
              parent: child.id.startsWith("asm:") ? child.label : child.id,
            })
          )
        );
        terms.push(...nested.flatMap((child) => child.aliases));
        frontier = nested.flatMap((child) => child.items.slice(0, 10));
      }
    }
    return [...new Set(terms.map(normalizeInterest))]
      .filter((term) => term.length >= 2 && term.length <= 64)
      .slice(0, 160);
  };
  const [interestEntries, avoidedEntries] = await Promise.all([
    Promise.all(
      interests.map(async (root) => [root, await termsFor(root, true)] as const)
    ),
    // Avoidance expands aliases, never incidental related subjects.
    Promise.all(
      avoidedTopics.map(
        async (root) => [root, await termsFor(root, false)] as const
      )
    ),
  ]);
  const interestsMap = Object.fromEntries(interestEntries);
  const qualifiers = Object.fromEntries(
    interests
      .filter((root) => expansions.get(root)?.requiresContext)
      .map((root) => [root, networkContentTopics(root, [], ["en"])])
  );
  const avoided = Object.fromEntries(avoidedEntries);
  const related = Object.fromEntries(
    interests.map((root) => {
      const aliases = new Set(
        [root, ...(expansions.get(root)?.aliases ?? [])].map(normalizeInterest)
      );
      return [
        root,
        (interestsMap[root] ?? []).filter((term) => !aliases.has(term)),
      ];
    })
  );
  const scope: NetworkTopicScope = {
    avoided,
    interests: interestsMap,
    qualifiers,
    related,
    version: createHash("sha256")
      .update(JSON.stringify([interestsMap, avoided, related, qualifiers]))
      .digest("hex")
      .slice(0, 16),
  };
  if (scopeMemo.size >= 128) {
    const oldest = scopeMemo.keys().next().value;
    if (oldest) {
      scopeMemo.delete(oldest);
    }
  }
  scopeMemo.set(memoKey, { at: Date.now(), scope });
  return scope;
}
