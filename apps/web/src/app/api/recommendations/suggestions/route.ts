import {
  consumeRateLimit,
  getClientIpFromRequest,
  readNetworkPreferences,
  redis,
} from "@asm/db";
import { connection } from "next/server";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import { readDiscoverySuggestions } from "@/lib/recommendations/discovery-suggestions";
import { reportRecommendationHealth } from "@/lib/recommendations/health";
import { invalidateDiscoverySuggestions } from "@/lib/recommendations/suggestion-version";

const headers = { "cache-control": "private, no-store", vary: "Cookie" };
export async function GET(request: Request) {
  await connection();
  const session = await getSessionFromApi();
  const userId = session?.user.id ?? "";
  const profileId =
    new URL(request.url).searchParams.get("profile") || undefined;
  const rate = await consumeRateLimit({
    bucket: "discovery-suggestions",
    identifier: userId
      ? `${userId}:${profileId ?? "default"}`
      : `guest:${getClientIpFromRequest(request)}`,
    limit: userId ? 60 : 20,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return Response.json(
      { error: "Try again shortly" },
      {
        headers: { ...headers, "retry-after": String(rate.retryAfterSeconds) },
        status: 429,
      }
    );
  }
  try {
    const result = await readDiscoverySuggestions(
      userId,
      request.signal,
      profileId
    );
    reportRecommendationHealth("suggestions", true);
    return Response.json(result, { headers });
  } catch (error) {
    reportRecommendationHealth("suggestions", false, error);
    return Response.json(
      { error: "Suggestions are temporarily busy" },
      { headers: { ...headers, "retry-after": "5" }, status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user.id) {
    return new Response(null, { status: 401 });
  }
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (request.headers.get("origin") &&
      request.headers.get("origin") !== new URL(request.url).origin)
  ) {
    return new Response(null, { status: 403 });
  }
  const rate = await consumeRateLimit({
    bucket: "dismiss-suggestions",
    identifier: session.user.id,
    limit: 30,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return new Response(null, { status: 429 });
  }
  const raw = await request.text();
  if (raw.length > 4096) {
    return new Response(null, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = z
    .object({
      id: z.string().min(1).max(2048),
      source: z.enum(["asm", "bluesky"]),
    })
    .safeParse(body);
  if (!parsed.success) {
    return new Response(null, { status: 400 });
  }
  const { preferences } = await readNetworkPreferences(session.user.id);
  const key = `rec:suggestions:dismissed:${session.user.id}:${preferences.activeProfileId}`;
  await redis
    .multi()
    .zadd(key, Date.now(), `${parsed.data.source}:${parsed.data.id}`)
    .zremrangebyrank(key, 0, -201)
    .expire(key, 30 * 24 * 60 * 60)
    .exec();
  await invalidateDiscoverySuggestions(session.user.id);
  return Response.json({ dismissed: true }, { headers });
}
