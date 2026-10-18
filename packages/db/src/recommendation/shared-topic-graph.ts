import { createHash } from "node:crypto";

import { redis } from "../redis";
import { DynamicKnowledgeGraph } from "./knowledge-graph";

const PREFIX = "rec:topic-graph:v1:";
const TTL_SECONDS = 90 * 24 * 60 * 60;
const UPDATE = `
local fingerprint = ARGV[#KEYS + 1]
if redis.call('ZSCORE', KEYS[2], fingerprint) then return 0 end
redis.call('ZADD', KEYS[2], ARGV[2], fingerprint)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', tonumber(ARGV[2]) - tonumber(ARGV[1]) * 1000)
redis.call('ZREMRANGEBYRANK', KEYS[2], 0, -20001)
redis.call('EXPIRE', KEYS[2], ARGV[1])
for index = 3, #KEYS do
  redis.call('ZADD', KEYS[1], ARGV[2], KEYS[index])
  for other = 3, #KEYS do
    if other ~= index then redis.call('ZINCRBY', KEYS[index], 1, ARGV[other]) end
  end
  redis.call('ZREMRANGEBYRANK', KEYS[index], 0, -41)
  redis.call('EXPIRE', KEYS[index], ARGV[1])
end
redis.call('EXPIRE', KEYS[1], ARGV[1])
local stale = redis.call('ZRANGE', KEYS[1], 0, -5001)
for _, key in ipairs(stale) do redis.call('DEL', key); redis.call('ZREM', KEYS[1], key) end
return 1
`;

function cleanTopics(tags: readonly string[]): string[] {
  return [
    ...new Set(
      tags.map((tag) =>
        tag
          .normalize("NFKC")
          .toLowerCase()
          .replaceAll(/[^\p{L}\p{N}\p{M}_-]+/gu, "-")
          .replaceAll(/^-+|-+$/g, "")
      )
    ),
  ]
    .filter(Boolean)
    .slice(0, 20);
}

function topicKey(topic: string, namespace = PREFIX): string {
  return `${namespace}neighbors:${encodeURIComponent(topic)}`;
}

export async function recordSharedTopicRelations(
  tags: readonly string[],
  documentId: string,
  namespace = PREFIX
): Promise<void> {
  const topics = cleanTopics(tags).toSorted();
  if (topics.length < 2) {
    return;
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([documentId, topics]))
    .digest("hex");
  await redis.eval(
    UPDATE,
    topics.length + 2,
    `${namespace}nodes`,
    `${namespace}documents`,
    ...topics.map((topic) => topicKey(topic, namespace)),
    TTL_SECONDS,
    Date.now(),
    ...topics,
    fingerprint
  );
}

// Read only a bounded two-hop neighborhood, avoiding a whole-corpus load per user.
export async function loadSharedTopicGraph(
  tags: readonly string[],
  namespace = PREFIX
): Promise<DynamicKnowledgeGraph> {
  const graph = new DynamicKnowledgeGraph();
  let frontier = cleanTopics(tags);
  const visited = new Set<string>();
  for (let depth = 0; depth < 2; depth += 1) {
    const current = frontier.filter((tag) => !visited.has(tag)).slice(0, 32);
    // oxlint-disable-next-line no-await-in-loop -- the second hop depends on the first.
    const rows = await Promise.all(
      current.map((tag) =>
        redis.zrevrange(topicKey(tag, namespace), 0, 19, "WITHSCORES")
      )
    );
    frontier = [];
    for (const [index, neighbors] of rows.entries()) {
      const source = current[index];
      if (!source) {
        continue;
      }
      visited.add(source);
      for (let offset = 0; offset < neighbors.length; offset += 2) {
        const target = neighbors[offset];
        const weight = Number(neighbors[offset + 1]);
        if (target && Number.isFinite(weight) && weight > 0) {
          graph.addEdge(source, target, "related_to", weight);
          frontier.push(target);
        }
      }
    }
  }
  return graph;
}
