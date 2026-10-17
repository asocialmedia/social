import { and, prisma, redis, lifecycleMediaAllowed } from "@asm/db";
import { requireLifecycleValue } from "@asm/messages";

import { isBlockPairRule } from "@/lib/messages/blocks";
import { areBlocked } from "@/lib/messages/server";

// Admission check for message attachments on the media serving routes.
// Message media rows carry messageConversationId (bound at upload initiation
// after a membership check); the peer is admitted here via the same rule the
// message reads use: conversation member, with blocks enforced.
//
// Results are cached briefly in Redis so the hot byte-serving path does not
// hit Postgres per request. The TTL is deliberately short: it is the maximum
// delay before a block or membership change takes effect on media serving.
// The underlying check is two indexed primary-key lookups, so a miss is cheap
// and correctness wins over a longer cache. Every Redis failure falls through
// to the database so an outage fails open to correct (slower) decisions,
// never to wrong ones.
const ALLOW_TTL_SECONDS = 5;
const DENY_TTL_SECONDS = 5;

function admissionCacheKey(conversationId: string, viewerId: string): string {
  return `msgmedia:member:${conversationId}:${viewerId}`;
}

export async function isMessageMediaViewer(
  conversationId: string,
  viewerId: string
): Promise<boolean> {
  const key = admissionCacheKey(conversationId, viewerId);
  try {
    const cached = await redis.get(key);
    if (cached === "1") {
      return true;
    }
    if (cached === "0") {
      return false;
    }
  } catch {
    // Reconcile safely on the next request; do not expose source errors.
    // Redis unavailable: resolve from the database below.
  }

  const allowed = await checkMembership(conversationId, viewerId);

  try {
    await redis.set(
      key,
      allowed ? "1" : "0",
      "EX",
      allowed ? ALLOW_TTL_SECONDS : DENY_TTL_SECONDS
    );
  } catch {
    // Reconcile safely on the next request; do not expose source errors.
    // Cache write failures must not fail the request.
  }

  return allowed;
}

// Resolves the `isConversationMember` option for decideMediaAccess from a
// row's link: undefined when the media is not message-linked (other flavors
// decide without it), false for guests, and the cached membership otherwise.
// Shared by every serving route so the gate cannot drift between surfaces.
// Protected lifecycle media never uses the membership cache: expiry and
// session end must take effect immediately, not after the 5s TTL.
export async function resolveMessageMediaMembership(
  messageConversationId: string | null | undefined,
  viewerId: string | null | undefined,
  mediaId?: string,
  options: { allowProcessing?: boolean } = {}
): Promise<boolean | undefined> {
  if (mediaId) {
    const early = await lifecycleMediaAllowed(mediaId, viewerId ?? "", options);
    if (early !== null) {
      if (!messageConversationId) {
        return early;
      }
      if (!early) {
        return false;
      }
      // Protected and source-live: still require fresh membership below, bypassing the cache.
      const fresh =
        Boolean(viewerId) &&
        (await checkMembership(
          messageConversationId,
          requireLifecycleValue(viewerId)
        ));
      return fresh;
    }
  }
  if (!messageConversationId) {
    return undefined;
  }
  if (!viewerId) {
    return false;
  }
  // Awaited (not returned directly): the fixer strips bare `async` without
  // an await expression, which then fails type-checking against the Promise
  // return type.
  const memberAllowed = await isMessageMediaViewer(
    messageConversationId,
    viewerId
  );
  if (!memberAllowed) {
    return false;
  }
  if (mediaId) {
    const sourceAllowed = await lifecycleMediaAllowed(mediaId, viewerId);
    if (sourceAllowed !== null) {
      return sourceAllowed;
    }
  }
  return true;
}

async function checkMembership(
  conversationId: string,
  viewerId: string
): Promise<boolean> {
  const member = await prisma.orm.public.MessageConversationMembers.select(
    "userId"
  )
    .where((candidate) =>
      and(
        candidate.conversationId.eq(conversationId),
        candidate.userId.eq(viewerId)
      )
    )
    .first();
  if (!member) {
    return false;
  }
  // The message read gate, by way of the shared predicates rather than a copy of
  // them. A block is pairwise and a den has no pair, so a den's members are
  // admitted on membership alone; asking for a peer there would find an arbitrary
  // member and then deny this viewer their own media because of somebody else's
  // block.
  //
  // The type is read first so the den case costs one query and NO block probe at
  // all. That is not only a saving: a probe there would produce a wrong answer as
  // well as a slower one, and this is the byte-serving path, where the answer is
  // every image in a thread.
  const conversation = await prisma.orm.public.MessageConversations.select(
    "_type"
  )
    .where({ id: conversationId })
    .first();
  if (!conversation || !isBlockPairRule(conversation._type)) {
    return true;
  }
  const peer = await prisma.orm.public.MessageConversationMembers.select(
    "userId"
  )
    .where((candidate) =>
      and(
        candidate.conversationId.eq(conversationId),
        candidate.userId.notIn([viewerId])
      )
    )
    .first();
  if (peer === null) {
    return true;
  }
  return !(await areBlocked(viewerId, peer.userId));
}

// Only the den's active members may resolve its current shared wallpaper.
export async function resolveDenWallpaperConversationId(
  mediaId: string,
  viewerId: string | undefined
) {
  if (!viewerId) {
    return null;
  }
  const conversation = await prisma.orm.public.MessageConversations.select("id")
    .where((row) =>
      and(
        row._type.eq("DEN"),
        row.wallpaperMediaId.eq(mediaId),
        row.messageConversationMembers.some((member) =>
          and(member.userId.eq(viewerId), member.leftAt.isNull())
        )
      )
    )
    .first();
  return conversation?.id ?? null;
}
