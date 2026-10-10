import {
  and,
  getDenMembership,
  isDenShortCode,
  normalizeDenShortCode,
  prisma,
  previewInvite,
} from "@asm/db";
import { NextResponse } from "next/server";

import { getSessionFromApi } from "@/lib/auth/session";
import { generatePresignedUrl } from "@/lib/media/object-storage";
import { denIsFull } from "@/lib/messages/den-capacity";
import {
  DEN_JOIN_PREVIEW_RATE_LIMIT,
  consumeDenJoinRateLimit,
  denJoinPreviewIdentifier,
} from "@/lib/messages/den-rate-limit";

interface Params {
  params: Promise<{ code: string }>;
}

// The bytes behind the join screen's den picture.
//
// A presigned URL rather than a stream, and that is the whole design: `/api/media/
// {id}` admits conversation members and refuses everybody else, so a non-member
// holding an invite link cannot read a den avatar through it. Minting a one-hour
// presigned GET here instead keeps the object storage pipeline in one place - this
// route never touches a bucket - and gives the reader a URL that stops working on
// its own, so the media id in the preview never becomes a durable public address.
//
// Four refusals, all of them the same bytes a code that never existed gets, for the
// reason the join preview already refuses to be an oracle:
//
//   - no code, or one that does not resolve;
//   - a RETIRED code, which identifies a den but no longer opens one, so it gets
//     no picture (the product decision: the image is disclosed on live codes only);
//   - a code the reader can neither use nor already holds - a full den they are not
//     inside of, which is the "live joinable" half of that decision;
//   - a den with no image at all, which is `null` rather than a refusal, because
//     the join screen draws its placeholder either way.
//
// The one place it is NOT silent is the media lookup, and that is deliberate: if the
// conversation names a media id that is not bound to it, the request is refused
// rather than answered with that object, so a code cannot be used to read an
// arbitrary upload.
export async function GET(request: Request, { params }: Params) {
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  const { code } = await params;

  // The same session gate the preview route runs, for the same reason: a
  // 6-character code is guessable where a 12-character link is not, and the
  // picture endpoint would otherwise answer an anonymous sweep with a
  // presigned image of the room it is hunting. Byte-identical refusal to a
  // dead code, so the gate is not its own oracle.
  if (!userId && isDenShortCode(normalizeDenShortCode(code))) {
    return unavailable();
  }

  const limited = await consumeDenJoinRateLimit(
    DEN_JOIN_PREVIEW_RATE_LIMIT,
    denJoinPreviewIdentifier(request.headers, userId)
  );
  if (limited) {
    return limited;
  }

  const preview = await previewInvite(code);
  if (!preview || preview.expired) {
    return unavailable();
  }

  // Full is decided from the preview's own member count, which is the same number
  // the join screen's `full` state was decided from, so the picture and the button
  // cannot disagree about whether this link is any use.
  if (denIsFull(preview.memberCount)) {
    const member = userId ? await getDenMembership(preview.id, userId) : null;
    if (!member || member.leftAt !== null) {
      return unavailable();
    }
  }

  // No image is not a failure. The screen has a placeholder for exactly this.
  if (!preview.avatarMediaId) {
    return NextResponse.json(
      { avatarUrl: null },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const media = await prisma.orm.public.PostMedia.select(
    "id",
    "key",
    "mimeType",
    "publishedKey",
    "status"
  )
    .where((row) =>
      and(
        row.id.eq(preview.avatarMediaId as string),
        // The binding is what makes this a picture OF THIS DEN rather than an id
        // the preview happens to carry. A den avatar is bound at create time by
        // `bindDenAvatarToConversation`.
        row.messageConversationId.eq(preview.id)
      )
    )
    .first();
  if (!media) {
    return unavailable();
  }

  // The same lifecycle gate the media route applies: a quarantined, rejected or
  // still-scanning object is not bytes yet. A den avatar can legitimately be in a
  // pre-READY state for a moment after a create, so this refuses rather than 500s
  // and the screen falls back to its placeholder.
  if (media.status === "REJECTED" || media.status === "DELETED") {
    return unavailable();
  }
  const key = media.publishedKey || media.key;
  if (!key) {
    return unavailable();
  }

  const avatarUrl = await generatePresignedUrl(key);
  return NextResponse.json(
    { avatarUrl },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

// Byte-identical to the join preview's own refusal, so a sweep over this endpoint
// learns nothing a sweep over that one did not already teach.
function unavailable(): NextResponse {
  return NextResponse.json(
    { error: "That join code is not valid" },
    { status: 404 }
  );
}
