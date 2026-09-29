import { and, fromPrismaDateTime, prisma, toPrismaDateTime } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { isConversationThemeKey } from "@/lib/messages/conversation-theme";
import { getConversationForUser, parseJsonBody } from "@/lib/messages/server";

// Per-member DM preferences: mute and chat theme.
//
// Scoped to the caller's OWN membership row, so neither preference is visible
// to or editable by the peer, and both are DM-only for free (a message
// conversation is a 1:1 pair). The panel writes them; every other surface just
// reads what this returns.
//
// Only the keys present in the body are written, so the panel can send one
// without clobbering the other. Validation is strict rather than
// best-effort-on-read: an unknown theme key is rejected instead of stored, so a
// typo cannot leave a member on a theme no client can render.
export async function PATCH(
  request: Request,
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

  const body = (await parseJsonBody(request)) as {
    muted?: unknown;
    themeKey?: unknown;
  } | null;
  if (!body) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const hasMuted = "muted" in body;
  const hasTheme = "themeKey" in body;
  if (!hasMuted && !hasTheme) {
    return Response.json(
      { error: "Provide muted and/or themeKey" },
      { status: 400 }
    );
  }

  const data: {
    mutedAt?: ReturnType<typeof toPrismaDateTime> | null;
    themeKey?: string | null;
  } = {};

  if (hasMuted) {
    if (typeof body.muted !== "boolean") {
      return Response.json(
        { error: "muted must be a boolean" },
        { status: 400 }
      );
    }
    if (body.muted) {
      const myMember = conversation.members.find(
        (member) => member.userId === user.id
      );
      // Keep the ORIGINAL mute timestamp when re-muting an already muted chat.
      // `mutedAt` is when the mute started, not when it was last toggled, and
      // churning it on every press would throw away that history.
      data.mutedAt = toPrismaDateTime(myMember?.mutedAt ?? new Date());
    } else {
      data.mutedAt = null;
    }
  }

  if (hasTheme) {
    const { themeKey } = body;
    if (themeKey === null) {
      // Explicit null clears the override, which resolves to the app default.
      data.themeKey = null;
    } else if (isConversationThemeKey(themeKey)) {
      data.themeKey = themeKey;
    } else {
      return Response.json({ error: "Unknown themeKey" }, { status: 400 });
    }
  }

  const member = await prisma.orm.public.MessageConversationMembers.where(
    (row) => and(row.conversationId.eq(id), row.userId.eq(user.id))
  )
    .select("mutedAt", "themeKey")
    .update(data);

  // getConversationForUser already proved the membership exists, so a null here
  // means the row was removed between the check and this write.
  if (!member) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  return Response.json({
    prefs: {
      mutedAt: member.mutedAt
        ? fromPrismaDateTime(member.mutedAt).toISOString()
        : null,
      themeKey: member.themeKey,
    },
  });
}
