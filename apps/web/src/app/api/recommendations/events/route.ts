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

function isForeignKeyError(error: unknown): boolean {
  return isRecord(error) && error.code === "P2003";
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

  // A post can be deleted while a viewer still has it on screen, so an event
  // for a missing post is stale telemetry, not a client error. Dropping just
  // those events (and accepting the rest) is important: rejecting the whole
  // batch would make the client re-queue it forever, so one deleted post would
  // permanently stall every later event behind it.
  const postIds = [...new Set(events.map((event) => event.postId))];
  const posts = await prisma.post.findMany({
    select: { id: true },
    where: { id: { in: postIds } },
  });
  const existingPostIds = new Set(posts.map((post) => post.id));
  let acceptedEvents = events.filter((event) =>
    existingPostIds.has(event.postId)
  );
  if (acceptedEvents.length === 0) {
    // Nothing left to record; report success so the batch is not retried.
    return Response.json({ accepted: 0 });
  }

  const insertEvents = (eventList: RecommendationEventInput[]) =>
    prisma.recommendationEvent.createMany({
      data: eventList.map((event) => ({
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

  try {
    await insertEvents(acceptedEvents);
  } catch (error) {
    // The existence check above and this insert are separate queries, so a post
    // can be deleted in between and trip the foreign key, which would reject the
    // whole batch. Re-check once and retry with only the posts that still exist;
    // anything else is a genuine failure and is rethrown.
    if (!isForeignKeyError(error)) {
      throw error;
    }
    const remainingPosts = await prisma.post.findMany({
      select: { id: true },
      where: { id: { in: acceptedEvents.map((event) => event.postId) } },
    });
    const remainingPostIds = new Set(remainingPosts.map((post) => post.id));
    acceptedEvents = acceptedEvents.filter((event) =>
      remainingPostIds.has(event.postId)
    );
    if (acceptedEvents.length === 0) {
      return Response.json({ accepted: 0 });
    }
    await insertEvents(acceptedEvents);
  }
  const eventCounts = Object.fromEntries(
    [...new Set(acceptedEvents.map((event) => event.eventType))].map(
      (eventType) => [
        eventType,
        acceptedEvents.filter((event) => event.eventType === eventType).length,
      ]
    )
  );
  logger.info(
    {
      droppedCount: events.length - acceptedEvents.length,
      eventCount: acceptedEvents.length,
      eventCounts,
      userId,
    },
    "recommendation events accepted"
  );
  if (acceptedEvents.some((event) => event.eventType === "NOT_INTERESTED")) {
    void invalidateFypProfile(userId);
  }

  return Response.json({ accepted: acceptedEvents.length });
}
