import { prisma, redis } from "@asm/db";

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
    // Cache write failures must not fail the request.
  }

  return allowed;
}

// Resolves the `isConversationMember` option for decideMediaAccess from a
// row's link: undefined when the media is not message-linked (other flavors
// decide without it), false for guests, and the cached membership otherwise.
// Shared by every serving route so the gate cannot drift between surfaces.
export async function resolveMessageMediaMembership(
  messageConversationId: string | null | undefined,
  viewerId: string | null | undefined
): Promise<boolean | undefined> {
  if (!messageConversationId) {
    return undefined;
  }
  if (!viewerId) {
    return false;
  }
  // Awaited (not returned directly): the fixer strips bare `async` without
  // an await expression, which then fails type-checking against the Promise
  // return type.
  return await isMessageMediaViewer(messageConversationId, viewerId);
}

async function checkMembership(
  conversationId: string,
  viewerId: string
): Promise<boolean> {
  const member = await prisma.messageConversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: viewerId } },
  });
  if (!member) {
    return false;
  }
  // Mirror the message read gate: a blocked pair loses access, not just the
  // ability to send.
  const peer = await prisma.messageConversationMember.findFirst({
    select: { userId: true },
    where: { conversationId, userId: { not: viewerId } },
  });
  if (peer && (await areBlocked(viewerId, peer.userId))) {
    return false;
  }
  return true;
}
