// REST post creation for native clients. Web publishes through the
// `submitPost` server action, whose action id changes every build, so the
// native app cannot call it; this handler runs the exact same function
// (same zod schemas, session check, ownership/claim rules, community and
// response checks, aura, realtime). The edge proxy's origin check and
// install-token gate cover it like every other mutating /api route.
//
// Retries are made safe by an optional `Idempotency-Key` header (see
// lib/posts/idempotency.ts): a retry of a create that already succeeded
// gets `409 { error: "duplicate", postId }` instead of a second post.
import { redis } from "@asm/db";
import { ZodError } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import { getWebLogger } from "@/lib/otel";
import {
  IDEMPOTENCY_PENDING,
  IDEMPOTENCY_TTL_SECONDS,
  idempotencyRedisKey,
  parseIdempotencyKey,
} from "@/lib/posts/idempotency";
import { submitPost } from "@/posts/editor/actions";

type SubmitPostInput = Parameters<typeof submitPost>[0];

function logError(message: string, context: Record<string, unknown>) {
  const logger = getWebLogger();
  if (logger) {
    logger.error(context, message);
  } else {
    console.error(message, context);
  }
}

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const idempotency = parseIdempotencyKey(
    request.headers.get("idempotency-key")
  );
  if (!idempotency.ok) {
    return Response.json({ error: "Invalid Idempotency-Key" }, { status: 400 });
  }

  let body: SubmitPostInput;
  try {
    body = (await request.json()) as SubmitPostInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const redisKey = idempotency.key
    ? idempotencyRedisKey(user.id, idempotency.key)
    : null;
  if (redisKey) {
    const claimed = await redis.set(
      redisKey,
      IDEMPOTENCY_PENDING,
      "EX",
      IDEMPOTENCY_TTL_SECONDS,
      "NX"
    );
    if (claimed !== "OK") {
      const existing = await redis.get(redisKey);
      if (existing && existing !== IDEMPOTENCY_PENDING) {
        return Response.json(
          { error: "duplicate", postId: existing },
          { status: 409 }
        );
      }
      // The first attempt is still running; the client waits and retries.
      return Response.json(
        { error: "in-flight" },
        { headers: { "retry-after": "2" }, status: 409 }
      );
    }
  }

  try {
    const post = await submitPost(body);
    if (!post) {
      throw new TypeError("submitPost returned no post");
    }
    if (redisKey) {
      await redis.set(redisKey, post.id, "EX", IDEMPOTENCY_TTL_SECONDS);
    }
    return Response.json(post, { status: 201 });
  } catch (error) {
    if (redisKey) {
      await redis.del(redisKey);
    }
    if (error instanceof ZodError) {
      return Response.json(
        {
          error: error.issues[0]?.message ?? "Invalid post",
          issues: error.issues,
        },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("You are not logged in")) {
      return Response.json({ error: message }, { status: 401 });
    }
    // submitPost throws plain `Error`s with user-facing copy for rule
    // violations (missing community membership, invalid attachments, gone
    // parent post); those are client errors. Subclasses (Prisma, TypeError,
    // network) are internal: logged and hidden behind generic copy.
    if (message && error instanceof Error && error.constructor === Error) {
      return Response.json({ error: message }, { status: 400 });
    }
    logError("Post create failed", { error, userId: user.id });
    return Response.json(
      { error: "Couldn't create your post, try again?" },
      { status: 500 }
    );
  }
}
