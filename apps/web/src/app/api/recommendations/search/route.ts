import {
  consumeRateLimit,
  networkContentTopics,
  readNetworkPreferences,
  recordNetworkSignal,
} from "@asm/db";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import { invalidateDiscoverySuggestions } from "@/lib/recommendations/suggestion-version";
import { isTrustedMutationOrigin } from "@/lib/security/request-origin";

const schema = z.object({
  authorId: z.string().min(1).max(2048).optional(),
  query: z.string().trim().min(2).max(80),
  source: z.enum(["asm", "bluesky"]).optional(),
});
export async function POST(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user.id) {
    return new Response(null, { status: 204 });
  }
  if (!isTrustedMutationOrigin(request)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  const rate = await consumeRateLimit({
    bucket: "search-learning",
    identifier: session.user.id,
    limit: 60,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return new Response(null, { status: 429 });
  }
  const raw = await request.text();
  if (raw.length > 4096) {
    return new Response(null, { status: 413 });
  }
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return new Response(null, { status: 400 });
  }
  const settings = await readNetworkPreferences(session.user.id);
  const { query, authorId, source } = parsed.data;
  const added = await recordNetworkSignal(
    session.user.id,
    settings.preferences.activeProfileId,
    {
      authorId: source && authorId ? `${source}:${authorId}` : "",
      createdAt: Date.now(),
      kind: "search",
      tags: networkContentTopics(query),
    },
    `search:${query.toLowerCase()}:${source ?? ""}:${authorId ?? ""}`,
    false,
    undefined,
    settings.revision
  );
  if (added) {
    await invalidateDiscoverySuggestions(session.user.id);
  }
  return Response.json(
    { learned: added },
    { headers: { "cache-control": "private, no-store" } }
  );
}
