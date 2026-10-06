import {
  and,
  fromPrismaDateTime,
  listDenMembershipEvents,
  prisma,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { readerMessageWindows } from "@/lib/messages/reader-window";
import { getConversationForUser } from "@/lib/messages/server";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const [keys, mySentCount] = await Promise.all([
    prisma.orm.public.MessageConversationKeys.select(
      "encryptedKey",
      "iv",
      "ownerUserId",
      "version",
      "wrapperPublicKey",
      "wrapperUserId"
    )
      .where({ conversationId: id })
      .all(),
    prisma.orm.public.Messages.where((message) =>
      and(message.conversationId.eq(id), message.senderId.eq(user.id))
    ).aggregate((aggregate) => ({ count: aggregate.count() })),
  ]);

  // The caller's own preferences, lifted out of the member list so the client
  // never has to pick "my" row out of a two-element array. The conversation
  // payload still carries every member row (the thread reads the peer's), so
  // this is a convenience read, not a privacy boundary.
  const myMember = conversation.members.find(
    (member) => member.userId === user.id
  );

  // Every member's presence stints, so the client's heal gate can tell "was in
  // the room when this epoch was minted" for a member who left and came back -
  // the row alone cannot say it, because a rejoin clears `leftAt` on the
  // original row and keeps the first join as `createdAt`.
  //
  // The log is capped at the reader's own `leftAt`, the same cutoff the
  // transcript's events route applies: a departed reader is shown the room as it
  // was when they walked out, and a window derived from lines past that moment
  // would leak the roster changes themselves. For the reader's OWN windows the
  // cap costs nothing - their lines all lie at or before their own departure.
  const membershipEvents =
    conversation.type === "DEN"
      ? await listDenMembershipEvents(id, myMember?.leftAt ?? null)
      : [];

  return Response.json({
    conversation: {
      ...conversation,
      members: conversation.members.map((member) => ({
        ...member,
        membershipWindows:
          conversation.type === "DEN"
            ? readerMessageWindows({
                conversationType: conversation.type,
                events: membershipEvents,
                membership: {
                  createdAt: fromPrismaDateTime(member.createdAt),
                  leftAt: member.leftAt ?? null,
                },
                userId: member.userId,
              }).map((window) => ({
                after: window.after?.toISOString() ?? null,
                before: window.before?.toISOString() ?? null,
              }))
            : undefined,
      })),
    },
    // The wrapper columns ride along because a den reader needs them: a wrap row
    // says which member produced it, and only that member's public key can unwrap
    // it. A DM row has neither, and the client falls back to the peer.
    keys: keys.map((key) => ({
      encryptedKey: {
        ciphertext: key.encryptedKey,
        iv: key.iv,
      },
      ownerUserId: key.ownerUserId,
      version: key.version,
      wrapperPublicKey: key.wrapperPublicKey,
      wrapperUserId: key.wrapperUserId,
    })),
    mySentCount: mySentCount.count,
    prefs: {
      mutedAt: myMember?.mutedAt?.toISOString() ?? null,
      themeKey: myMember?.themeKey ?? null,
      wallpaperDim: myMember?.wallpaperDim ?? null,
      wallpaperKey: myMember?.wallpaperKey ?? null,
      wallpaperMediaId: myMember?.wallpaperMediaId ?? null,
    },
  });
}
