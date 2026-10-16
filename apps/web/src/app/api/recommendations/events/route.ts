import {
  consumeRateLimit,
  invalidateFypProfile,
  prisma,
  resolveRankingContext,
  rememberRankingImpression,
} from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";

const MAX_EVENTS_PER_REQUEST = 50;
const MAX_DURATION_MS = 30 * 60 * 1000;
const logger = createLogger({ serviceName: "api-recommendation-events" });
const EVENT_TYPES = new Set([
  "IMPRESSION",
  "BUFFER",
  "PLAYBACK_ERROR",
  "PLAYBACK_STARTUP",
  "VIEW_START",
  "VIEW_COMPLETE",
  "DWELL",
  "SKIP",
  "NOT_INTERESTED",
  "SHARE",
]);

interface RecommendationEventInput {
  eventId?: string;
  requestId?: string;
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

function isDuplicateKeyError(error: unknown): boolean {
  return (
    isRecord(error) &&
    (error.code === "P2002" ||
      error.sqlState === "23505" ||
      error.constraint === "recommendation_events_dedupeKey_key")
  );
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
    ...(typeof value.eventId === "string" &&
    /^[a-z\d_-]{1,80}$/i.test(value.eventId)
      ? { eventId: value.eventId }
      : {}),
    ...(typeof value.requestId === "string" &&
    /^[a-f\d-]{36}$/i.test(value.requestId)
      ? { requestId: value.requestId }
      : {}),
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
  const posts = await prisma.orm.public.Posts.select("id")
    .where((post) => post.id.in(postIds))
    .all();
  const existingPostIds = new Set(posts.map((post) => post.id));
  let acceptedEvents = events.filter((event) =>
    existingPostIds.has(event.postId)
  );
  if (acceptedEvents.length === 0) {
    // Nothing left to record; report success so the batch is not retried.
    return Response.json({ accepted: 0 });
  }

  const insertEvents = async (eventList: RecommendationEventInput[]) => {
    // Served pages scope impressions to an exposure; legacy events use a UTC day.
    // The client re-sends impressions on re-render/scroll/refetch, so the same
    // key arrives repeatedly. A plain create() turns every repeat into a
    // Postgres ERROR log line (even when the app swallows it). Upsert on the
    // key is atomic (ON CONFLICT DO NOTHING) so repeats are silent, and
    // in-batch dedupe avoids firing N identical writes for the same key.
    const day = new Date().toISOString().slice(0, 10);
    const contexts = new Map<
      string,
      Awaited<ReturnType<typeof resolveRankingContext>>
    >();
    const unique = new Map(
      eventList.map((event) => [
        `${event.requestId ?? ""}:${event.postId}`,
        event,
      ])
    );
    await Promise.all(
      [...unique].map(async ([key, event]) => {
        contexts.set(
          key,
          await resolveRankingContext(userId, event.postId, event.requestId)
        );
      })
    );
    const exposureKey = (event: RecommendationEventInput) =>
      contexts.get(`${event.requestId ?? ""}:${event.postId}`)?.requestId ??
      day;
    const seenImpressionKeys = new Set<string>();
    const deduped = eventList.filter((event) => {
      if (event.eventType !== "IMPRESSION") {
        return true;
      }
      const key = `impression:${userId}:${event.postId}:${exposureKey(event)}`;
      if (seenImpressionKeys.has(key)) {
        return false;
      }
      seenImpressionKeys.add(key);
      return true;
    });

    const insertEvent = async (event: RecommendationEventInput) => {
      const rankingContext = contexts.get(
        `${event.requestId ?? ""}:${event.postId}`
      );
      let dedupeKey: string | null = null;
      if (event.eventType === "IMPRESSION") {
        dedupeKey = `impression:${userId}:${event.postId}:${exposureKey(event)}`;
      } else if (rankingContext && event.eventId) {
        dedupeKey = `event:${userId}:${event.postId}:${rankingContext.requestId}:${event.eventId}`;
      }
      const attribution = rankingContext
        ? { rankingContext: { ...rankingContext } }
        : {};
      try {
        await (dedupeKey
          ? prisma.orm.public.RecommendationEvents.upsert({
              conflictOn: { dedupeKey },
              create: {
                ...attribution,
                dedupeKey,
                durationMs: event.durationMs ?? null,
                eventType: event.eventType,
                postId: event.postId,
                sessionId: session.session?.id ?? null,
                userId,
                value: event.value ?? null,
              },
              update: {},
            })
          : prisma.orm.public.RecommendationEvents.create({
              ...attribution,
              dedupeKey,
              durationMs: event.durationMs ?? null,
              eventType: event.eventType,
              postId: event.postId,
              sessionId: session.session?.id ?? null,
              userId,
              value: event.value ?? null,
            }));
        if (event.eventType === "IMPRESSION" && rankingContext) {
          await rememberRankingImpression(userId, event.postId, rankingContext);
        }
      } catch (error) {
        // Safety net for a race between two batches carrying the same key.
        if (!isDuplicateKeyError(error)) {
          throw error;
        }
      }
    };

    await Promise.all(deduped.map(insertEvent));
  };

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
    const remainingPosts = await prisma.orm.public.Posts.select("id")
      .where((post) => post.id.in(acceptedEvents.map((event) => event.postId)))
      .all();
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
  if (
    acceptedEvents.some((event) =>
      ["NOT_INTERESTED", "DWELL", "VIEW_COMPLETE", "SKIP", "SHARE"].includes(
        event.eventType
      )
    )
  ) {
    void invalidateFypProfile(userId);
  }

  return Response.json({ accepted: acceptedEvents.length });
}
