import { timingSafeEqual } from "node:crypto";

import {
  externalFollowRegistry,
  reconcileExternalAuthor,
  redis,
} from "@asm/db";
import { FEED_EVENTS_CHANNEL, readJsonBounded } from "@asm/protocols/discovery";
import { z } from "zod";

const reports = z
  .array(
    z.object({
      did: z
        .string()
        .max(2048)
        .regex(/^did:(?:plc|web):[A-Za-z0-9._:%-]+$/),
      displayName: z.string().max(2560).optional(),
      handle: z.string().max(253).optional(),
      status: z.enum([
        "active",
        "deleted",
        "deactivated",
        "takendown",
        "suspended",
        "desynchronized",
        "throttled",
        "unknown",
      ]),
    })
  )
  .max(20);

function authorized(request: Request) {
  const expected = process.env.PROTOCOLS_INTERNAL_TOKEN;
  const received = request.headers
    .get("authorization")
    ?.replace(/^Bearer /, "");
  return Boolean(
    expected &&
    received &&
    Buffer.byteLength(expected) === Buffer.byteLength(received) &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return new Response(null, { status: 401 });
  }
  return Response.json(await externalFollowRegistry(), {
    headers: { "cache-control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return new Response(null, { status: 401 });
  }
  const body = reports.safeParse(
    await readJsonBounded(
      request,
      64 * 1024,
      AbortSignal.any([request.signal, AbortSignal.timeout(3000)])
    )
  );
  if (!body.success) {
    return new Response(null, { status: 400 });
  }
  // Apply in source order; duplicate reports are harmless.
  for (const report of body.data) {
    // oxlint-disable-next-line no-await-in-loop -- lifecycle transitions must retain source ordering.
    await reconcileExternalAuthor(report);
  }
  await redis
    .publish(
      FEED_EVENTS_CHANNEL,
      JSON.stringify({ source: "bluesky-following" })
    )
    .catch(() => null);
  return Response.json(
    { ok: true },
    { headers: { "cache-control": "private, no-store" } }
  );
}
