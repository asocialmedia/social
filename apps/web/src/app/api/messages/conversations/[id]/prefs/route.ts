import {
  and,
  fromPrismaDateTime,
  prisma,
  toPrismaDateTime,
  unreadMessageCache,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { isConversationThemeKey } from "@/lib/messages/conversation-theme";
import {
  isConversationWallpaperKey,
  isWallpaperDim,
} from "@/lib/messages/conversation-wallpaper";
import {
  DEN_PREFS_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";
import {
  canManageDenWallpaper,
  updateDenWallpaper,
} from "@/lib/messages/den-wallpaper";
import {
  getConversationForUser,
  hasLeftConversation,
  leftConversationResponse,
  parseJsonBody,
} from "@/lib/messages/server";

// Per-member DM preferences: mute, chat theme, and chat wallpaper.
//
// Scoped to the caller's OWN membership row, so none of these preferences is
// visible to or editable by the peer, and all are DM-only for free (a message
// conversation is a 1:1 pair). The panel writes them; every other surface just
// reads what this returns.
//
// Only the keys present in the body are written, so the panel can send one
// without clobbering the others. Validation is strict rather than
// best-effort-on-read: an unknown theme or wallpaper key, or a dim that is not
// one this build can render, is rejected instead of stored, so a typo cannot
// leave a member on a setting no client can paint.
//
// `wallpaperMediaId` is deliberately NOT settable here: an uploaded wallpaper is
// claimed by the dedicated link route, which is the only place that checks the
// media row is the caller's own, finished, and a usable image. This route only
// ever clears it, to keep a preset and an upload from both being set.
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Four single-column writes to the caller's own member row, behind controls
  // that can fire per step and per keystroke. Metered before the membership
  // read.
  const limited = await consumeDenRateLimit(DEN_PREFS_RATE_LIMIT, user.id);
  if (limited) {
    return limited;
  }

  const { id } = await ctx.params;
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  // Per-person settings on a den somebody has left. A muted thread, a theme and a
  // wallpaper are all about the reading experience, and a person who is no longer
  // receiving anything has nothing to mute - but the refusal is uniform anyway,
  // because a wall of one-off carve-outs is where the next write gets added.
  if (hasLeftConversation(conversation, user.id)) {
    return leftConversationResponse();
  }

  const body = (await parseJsonBody(request)) as {
    muted?: unknown;
    themeKey?: unknown;
    wallpaperDim?: unknown;
    wallpaperKey?: unknown;
  } | null;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const hasMuted = "muted" in body;
  const hasTheme = "themeKey" in body;
  const hasWallpaper = "wallpaperKey" in body;
  const hasDim = "wallpaperDim" in body;
  if (!hasMuted && !hasTheme && !hasWallpaper && !hasDim) {
    return Response.json(
      { error: "Provide muted, themeKey, wallpaperKey and/or wallpaperDim" },
      { status: 400 }
    );
  }

  const data: {
    mutedAt?: ReturnType<typeof toPrismaDateTime> | null;
    themeKey?: string | null;
    wallpaperDim?: number | null;
    wallpaperKey?: string | null;
    // Only ever written by the wallpaperKey branch, to keep a preset and an
    // upload from ever both being set. Not settable directly.
    wallpaperMediaId?: string | null;
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

  if (hasWallpaper) {
    const { wallpaperKey } = body;
    if (wallpaperKey === null) {
      // Explicit null clears the override: no wallpaper, plain app background.
      // An upload is cleared in the same write, so "no wallpaper" really means
      // none rather than falling back to one the member picked earlier.
      data.wallpaperKey = null;
      data.wallpaperMediaId = null;
    } else if (isConversationWallpaperKey(wallpaperKey)) {
      data.wallpaperKey = wallpaperKey;
      // A preset and an upload are mutually exclusive. Clearing the upload here
      // is also what stops a set-but-unpainted upload from shadowing the preset
      // the member just chose.
      data.wallpaperMediaId = null;
    } else {
      return Response.json({ error: "Unknown wallpaperKey" }, { status: 400 });
    }
  }

  if (hasDim) {
    const { wallpaperDim } = body;
    if (wallpaperDim === null) {
      data.wallpaperDim = null;
    } else if (isWallpaperDim(wallpaperDim)) {
      data.wallpaperDim = wallpaperDim;
    } else {
      return Response.json({ error: "Unknown wallpaperDim" }, { status: 400 });
    }
  }

  if (
    (hasWallpaper || hasDim) &&
    !canManageDenWallpaper(conversation, user.id)
  ) {
    return Response.json(
      { error: "Only owners and elders can change the den wallpaper" },
      { status: 403 }
    );
  }
  let sharedWallpaper =
    conversation.type === "DEN"
      ? {
          wallpaperDim: conversation.wallpaperDim,
          wallpaperKey: conversation.wallpaperKey,
          wallpaperMediaId: conversation.wallpaperMediaId,
        }
      : null;
  if (conversation.type === "DEN" && (hasWallpaper || hasDim)) {
    sharedWallpaper = await updateDenWallpaper(id, user.id, {
      ...(hasWallpaper
        ? { wallpaperKey: data.wallpaperKey, wallpaperMediaId: null }
        : {}),
      ...(hasDim ? { wallpaperDim: data.wallpaperDim } : {}),
    });
    if (!sharedWallpaper) {
      return Response.json(
        { error: "Wallpaper change is no longer permitted" },
        { status: 403 }
      );
    }
  }
  const memberData =
    conversation.type === "DEN"
      ? {
          ...(hasMuted ? { mutedAt: data.mutedAt } : {}),
          ...(hasMuted ? { unreadCount: null } : {}),
          ...(hasTheme ? { themeKey: data.themeKey } : {}),
        }
      : { ...data, ...(hasMuted ? { unreadCount: null } : {}) };
  const memberQuery = prisma.orm.public.MessageConversationMembers.where(
    (row) => and(row.conversationId.eq(id), row.userId.eq(user.id))
  ).select(
    "mutedAt",
    "themeKey",
    "wallpaperDim",
    "wallpaperKey",
    "wallpaperMediaId"
  );
  const member =
    Object.keys(memberData).length > 0
      ? await memberQuery.update(memberData)
      : await memberQuery.first();

  // getConversationForUser already proved the membership exists, so a null here
  // means the row was removed between the check and this write.
  if (!member) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Mute changes what the unread seed is allowed to count, so the cached
  // counter is now wrong in both directions: muting has to drop the badge for
  // messages already counted, and unmuting has to bring it back. The counter
  // carries no TTL and is only rebuilt when absent, so resetting is the only
  // thing that forces the next read to reseed from the database. Best-effort:
  // the preference is already durable and a failed reset just delays the
  // correction to the next read.
  if (hasMuted) {
    await unreadMessageCache.reset(user.id);
  }

  return Response.json({
    prefs: {
      mutedAt: member.mutedAt
        ? fromPrismaDateTime(member.mutedAt).toISOString()
        : null,
      themeKey: member.themeKey,
      wallpaperDim: sharedWallpaper
        ? sharedWallpaper.wallpaperDim
        : member.wallpaperDim,
      wallpaperKey: sharedWallpaper
        ? sharedWallpaper.wallpaperKey
        : member.wallpaperKey,
      // Returned even though this route only ever clears it: the client treats
      // the response as the whole prefs object, so omitting it would make every
      // unrelated write look like it removed the member's uploaded wallpaper.
      wallpaperMediaId: sharedWallpaper
        ? sharedWallpaper.wallpaperMediaId
        : member.wallpaperMediaId,
    },
  });
}
