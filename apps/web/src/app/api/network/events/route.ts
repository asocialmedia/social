import {
  consumeRateLimit,
  readNetworkPreferences,
  recordNetworkSignal,
  removeNetworkSignal,
} from "@asm/db";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import { verifyNetworkObservation } from "@/lib/recommendations/network-observation";

const schema = z.object({
  events: z
    .array(
      z.object({
        durationMs: z.number().finite().min(0).max(1_800_000).optional(),
        eventType: z.string().max(40),
        networkToken: z.string().max(8000),
      })
    )
    .min(1)
    .max(50),
});
const kinds = {
  BOOKMARK: "bookmark",
  COMMENT: "comment",
  DOWNVOTE: "downvote",
  NOT_INTERESTED: "notInterested",
  REMOVE_DOWNVOTE: "downvote",
  REMOVE_NOT_INTERESTED: "notInterested",
  SHARE: "amplify",
  SKIP: "skip",
  VIEW_COMPLETE: "viewComplete",
  VOTE: "amplify",
} as const;

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (request.headers.get("origin") &&
      request.headers.get("origin") !== new URL(request.url).origin)
  ) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  const rate = await consumeRateLimit({
    bucket: "network-learning",
    identifier: session.user.id,
    limit: 120,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return Response.json({ error: "Try again shortly" }, { status: 429 });
  }
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Invalid learning events" }, { status: 400 });
  }
  const { preferences, revision } = await readNetworkPreferences(
    session.user.id
  );
  const accepted = await Promise.all(
    body.data.events.map(async (event) => {
      let kind: "dwell" | (typeof kinds)[keyof typeof kinds] | undefined;
      if (event.eventType === "DWELL" && (event.durationMs ?? 0) >= 5000) {
        kind = "dwell";
      } else if (Object.hasOwn(kinds, event.eventType)) {
        kind = kinds[event.eventType as keyof typeof kinds];
      }
      if (!kind) {
        return false;
      }
      const receipt = await verifyNetworkObservation(
        session.user.id,
        event.networkToken
      ).catch(() => null);
      if (
        !receipt ||
        receipt.revision !== revision ||
        !preferences.profiles.some(
          (profile) => profile.id === receipt.profileId
        )
      ) {
        return false;
      }
      if (
        event.eventType.startsWith("REMOVE_") &&
        (kind === "downvote" || kind === "notInterested")
      ) {
        return removeNetworkSignal(
          session.user.id,
          receipt.profileId,
          kind,
          `${receipt.source}:${receipt.postId}`
        );
      }
      return recordNetworkSignal(
        session.user.id,
        receipt.profileId,
        {
          authorId: `${receipt.source}:${receipt.authorId}`,
          createdAt: Date.now(),
          hasImage: receipt.hasImage,
          hasVideo: receipt.hasVideo,
          kind,
          tags: receipt.topics,
        },
        `${receipt.source}:${receipt.postId}`,
        false,
        undefined,
        revision
      );
    })
  );
  return Response.json(
    { accepted: accepted.filter(Boolean).length },
    { headers: { "cache-control": "private, no-store" } }
  );
}
