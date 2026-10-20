import {
  consumeRateLimit,
  knowledgeTopicPage,
  networkTopicCatalog,
} from "@asm/db";
import { interestSchema, normalizeInterest } from "@asm/protocols/discovery";
import type { NetworkTopic } from "@asm/protocols/discovery";

import { getSessionFromApi } from "@/lib/auth/session";

const headers = { "cache-control": "private, no-store", vary: "Cookie" };

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user.id) {
    return Response.json({ error: "Unauthorized" }, { headers, status: 401 });
  }
  const parameters = new URL(request.url).searchParams;
  const query = parameters.get("q")?.trim() ?? "";
  const parent = parameters.get("parent")?.trim() || undefined;
  if (
    (query && !interestSchema.safeParse(query).success) ||
    (parent && (parent.length > 128 || /[\p{C}]/u.test(parent)))
  ) {
    return Response.json(
      { error: "Invalid topic query" },
      { headers, status: 400 }
    );
  }
  const rate = await consumeRateLimit({
    bucket: "network-topics",
    identifier: session.user.id,
    limit: 120,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return Response.json(
      { error: "Try again shortly" },
      { headers, status: 429 }
    );
  }
  const [knowledge, local] = await Promise.allSettled([
    knowledgeTopicPage({ parent, query }),
    parent ? Promise.resolve([]) : networkTopicCatalog(query),
  ]);
  const data =
    knowledge.status === "fulfilled"
      ? knowledge.value
      : { aliases: [], items: [], parent: parent ?? null, partial: true };
  const items: NetworkTopic[] = [
    ...new Map(
      (query
        ? [...(local.status === "fulfilled" ? local.value : []), ...data.items]
        : [...data.items, ...(local.status === "fulfilled" ? local.value : [])]
      ).map((entry) => [normalizeInterest(entry.label), entry])
    ).values(),
  ].slice(0, parent ? 10 : 40);
  if (!items.length && knowledge.status === "rejected") {
    return Response.json(
      { error: "Topic suggestions are temporarily unavailable" },
      { headers, status: 503 }
    );
  }
  return Response.json(
    { ...data, items, partial: data.partial || local.status === "rejected" },
    { headers }
  );
}
