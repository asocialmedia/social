import { consumeRateLimit, invalidateFypProfile, prisma } from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";

const MAX_EVENTS_PER_REQUEST = 50;
const MAX_DURATION_MS = 30 * 60 * 1000;
const logger = createLogger({ serviceName: "api-recommendation-events" });
const EVENT_TYPES = new Set([
  "IMPRESSION",
  "VIEW_START",
  "VIEW_COMPLETE",
  "DWELL",
  "SKIP",
  "NOT_INTERESTED",
  "SHARE",
]);

interface RecommendationEventInput {
  durationMs?: number;
  eventType: string;
  postId: string;
  value?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseEvent(value: unknown): RecommendationEventInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const { durationMs, eventType, postId, value: signalValue } = value;
  if (
    typeof postId !== "string" ||
    postId.length === 0 ||
    typeof eventType !== "string" ||
    !EVENT_TYPES.has(eventType)
  ) {
    return null;
  }
  return {
    durationMs:
      typeof durationMs === "number" && Number.isFinite(durationMs)
        ? Math.max(0, Math.min(MAX_DURATION_MS, Math.trunc(durationMs)))
        : undefined,
    eventType,
    postId,
    value:
      typeof signalValue === "number" && Number.isFinite(signalValue)
        ? signalValue
        : undefined,
  };
}

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rate = await consumeRateLimit({
    bucket: "recommendation-events",
    identifier: `user:${userId}`,
    limit: 120,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    logger.warn({ userId }, "recommendation event rate limit exceeded");
    return Response.json(
      { error: "Too many recommendation events" },
      {
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
        status: 429,
      }
    );
  }

  const body = (await request.json().catch(() => null)) as unknown;
  const rawEvents =
    isRecord(body) && Array.isArray(body.events) ? body.events : [];
  if (rawEvents.length === 0 || rawEvents.length > MAX_EVENTS_PER_REQUEST) {
    return Response.json(
      { error: `events must contain 1-${MAX_EVENTS_PER_REQUEST} items` },
      { status: 400 }
    );
  }

  const events = rawEvents
    .map(parseEvent)
    .filter((event): event is RecommendationEventInput => event !== null);
  if (events.length !== rawEvents.length) {
    return Response.json(
      { error: "Invalid recommendation event" },
      { status: 400 }
    );
  }

  const postIds = [...new Set(events.map((event) => event.postId))];
  const posts = await prisma.post.findMany({
    select: { id: true },
    where: { id: { in: postIds } },
  });
  const existingPostIds = new Set(posts.map((post) => post.id));
  if (existingPostIds.size !== postIds.length) {
    return Response.json(
      { error: "One or more posts were not found" },
      { status: 404 }
    );
  }

  await prisma.recommendationEvent.createMany({
    data: events.map((event) => ({
      dedupeKey:
        event.eventType === "IMPRESSION"
          ? `impression:${userId}:${event.postId}:${new Date().toISOString().slice(0, 10)}`
          : undefined,
      durationMs: event.durationMs,
      eventType: event.eventType,
      postId: event.postId,
      sessionId: session.session?.id,
      userId,
      value: event.value,
    })),
    skipDuplicates: true,
  });
  const eventCounts = Object.fromEntries(
    [...new Set(events.map((event) => event.eventType))].map((eventType) => [
      eventType,
      events.filter((event) => event.eventType === eventType).length,
    ])
  );
  logger.info(
    {
      eventCount: events.length,
      eventCounts,
      userId,
    },
    "recommendation events accepted"
  );
  if (events.some((event) => event.eventType === "NOT_INTERESTED")) {
    void invalidateFypProfile(userId);
  }

  return Response.json({ accepted: events.length });
}
