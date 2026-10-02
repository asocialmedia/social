import {
  and,
  cancelMediaCleanup,
  fromPrismaDateTime,
  prisma,
  scheduleMediaCleanup,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { checkWallpaperUpload } from "@/lib/messages/conversation-wallpaper-upload";
import {
  DEN_WALLPAPER_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";
import {
  getConversationForUser,
  hasLeftConversation,
  leftConversationResponse,
  parseJsonBody,
} from "@/lib/messages/server";

// Links a member's own uploaded image as this conversation's custom chat
// wallpaper, and unlinks it again.
//
// Mirrors the avatar/banner link routes: the row is claimed onto the member's
// own preference row, never a shared one, so the peer cannot see it and the
// serving route only ever admits the uploader.
//
// The image itself is a normal pipeline upload (`purpose: "wallpaper"`), so it
// gets the same quarantine, ClamAV scan, magic-byte check and EXIF strip as
// every other upload. This route does not repeat any of that; it verifies what
// the pipeline cannot know, which is whether the finished image is usable AS A
// WALLPAPER, using the values the decoder measured off the real bytes.
//
// The caller's refreshed prefs come back in the response so the panel can write
// them into the conversation-detail cache and let the transcript repaint from
// the server's answer rather than from its own optimism.

// The member preference columns this route reads and writes, in one selection so
// the read of "what am I replacing" and the write cannot disagree.
const memberPrefsSelect = [
  "mutedAt",
  "themeKey",
  "wallpaperDim",
  "wallpaperKey",
  "wallpaperMediaId",
] as const;

interface MemberPrefs {
  mutedAt: unknown;
  themeKey: string | null;
  wallpaperDim: number | null;
  wallpaperKey: string | null;
  wallpaperMediaId: string | null;
}

// Echoed back in the same shape the prefs route returns, so the panel can treat
// this as "the server's current answer" without special-casing it.
function prefsPayload(member: MemberPrefs) {
  return {
    // Timestamp columns come back as the Prisma temporal type, not a JS Date, so
    // they go through the same converter every other read uses.
    mutedAt: member.mutedAt
      ? fromPrismaDateTime(member.mutedAt).toISOString()
      : null,
    themeKey: member.themeKey,
    wallpaperDim: member.wallpaperDim,
    wallpaperKey: member.wallpaperKey,
    wallpaperMediaId: member.wallpaperMediaId,
  };
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Replaced wallpapers are handed to the cleanup worker below, so an unbounded
  // loop here is a queue-fill primitive as much as an update loop. Metered before
  // the membership read, and once per call whichever method arrived.
  const limited = await consumeDenRateLimit(DEN_WALLPAPER_RATE_LIMIT, user.id);
  if (limited) {
    return limited;
  }

  const { id } = await ctx.params;
  // The same membership gate the prefs route uses: a wallpaper lives on YOUR row
  // of THIS conversation, so you must be in the conversation.
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (hasLeftConversation(conversation, user.id)) {
    return leftConversationResponse();
  }

  const body = (await parseJsonBody(request)) as { mediaId?: unknown } | null;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const { mediaId } = body;
  if (
    typeof mediaId !== "string" ||
    mediaId.length === 0 ||
    mediaId.length > 64
  ) {
    return Response.json({ error: "mediaId is required" }, { status: 400 });
  }

  const media = await prisma.orm.public.PostMedia.select(
    "detectedMime",
    "height",
    "id",
    "mimeType",
    "size",
    "status",
    "_type",
    "userId",
    "width"
  )
    .where({ id: mediaId })
    .first();
  if (!media || media.userId !== user.id) {
    // Deliberately opaque about other members' uploads, matching the avatar
    // route: a caller must not be able to probe for the existence of a media id
    // they do not own.
    return Response.json({ error: "Media not found" }, { status: 404 });
  }
  if (media.status !== "READY") {
    return Response.json(
      { error: "That wallpaper is still being prepared" },
      { status: 409 }
    );
  }
  if (media._type !== "IMAGE") {
    return Response.json(
      { error: "Only images can be used as a wallpaper" },
      { status: 415 }
    );
  }

  // The authoritative check. Initiation already ran the same policy, but on what
  // the CLIENT claimed; these are the decoder's own measurements, so a request
  // that lied its way past initiate is stopped here.
  //
  // `detectedMime` is the format identified from magic bytes during the scan, not
  // the browser's declared one, so the format allowlist is applied to what the
  // bytes actually are. Reusing the same policy module keeps the member's two
  // error messages the same sentence.
  const check = checkWallpaperUpload({
    height: media.height,
    mimeType: media.detectedMime ?? media.mimeType,
    sizeBytes: media.size,
    width: media.width,
  });
  if (!check.ok) {
    return Response.json({ error: check.rejection.message }, { status: 422 });
  }

  const currentMember =
    await prisma.orm.public.MessageConversationMembers.select(
      "wallpaperMediaId"
    )
      .where((row) => and(row.conversationId.eq(id), row.userId.eq(user.id)))
      .first();

  // The claim and the clear land in the same update, so no interleaving can
  // leave both a preset and an upload set on the row.
  const member = await prisma.orm.public.MessageConversationMembers.where(
    (row) => and(row.conversationId.eq(id), row.userId.eq(user.id))
  )
    .select(...memberPrefsSelect)
    .update({ wallpaperKey: null, wallpaperMediaId: media.id });

  if (!member) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Stop the reaper that initiate scheduled. The row is linked now, so the
  // reaper's attachment check would spare it anyway; cancelling makes that
  // explicit and avoids a lookup of a job that may be days old.
  try {
    await cancelMediaCleanup(media.id);
  } catch (error) {
    console.error("Failed to cancel media cleanup for wallpaper:", error);
  }

  // The replaced upload is now unlinked, so hand it to the cleanup worker instead
  // of deleting inline: that job re-checks attachment before removing anything,
  // which closes the race where the same image is re-picked in between.
  const previousMediaId =
    currentMember?.wallpaperMediaId &&
    currentMember.wallpaperMediaId !== media.id
      ? currentMember.wallpaperMediaId
      : null;
  if (previousMediaId) {
    try {
      await scheduleMediaCleanup(previousMediaId);
    } catch (error) {
      console.error(
        "Failed to schedule cleanup for replaced wallpaper:",
        error
      );
    }
  }

  return Response.json({ prefs: prefsPayload(member) });
}

// Clears the custom upload, returning the chat to what it would show with no
// upload: the app default, or the preset the member had picked. Backs the
// "Remove" action on the current wallpaper.
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  // Same bucket as the link above, because the cleanup job this schedules is the
  // expensive half and both methods schedule one.
  const limited = await consumeDenRateLimit(DEN_WALLPAPER_RATE_LIMIT, user.id);
  if (limited) {
    return limited;
  }

  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (hasLeftConversation(conversation, user.id)) {
    return leftConversationResponse();
  }

  const currentMember =
    await prisma.orm.public.MessageConversationMembers.select(
      "wallpaperMediaId"
    )
      .where((row) => and(row.conversationId.eq(id), row.userId.eq(user.id)))
      .first();

  const member = await prisma.orm.public.MessageConversationMembers.where(
    (row) => and(row.conversationId.eq(id), row.userId.eq(user.id))
  )
    .select(...memberPrefsSelect)
    .update({ wallpaperMediaId: null });

  if (!member) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Unlinked, so schedule the reaper to reclaim the bytes. Deliberately not
  // immediate: the member may be about to re-pick the same image, and the
  // cleanup job re-checks attachment first anyway.
  if (currentMember?.wallpaperMediaId) {
    try {
      await scheduleMediaCleanup(currentMember.wallpaperMediaId);
    } catch (error) {
      console.error("Failed to schedule cleanup for removed wallpaper:", error);
    }
  }

  return Response.json({ prefs: prefsPayload(member) });
}
