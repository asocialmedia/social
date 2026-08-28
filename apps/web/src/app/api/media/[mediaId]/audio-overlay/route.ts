import { NextResponse } from "next/server";
import { z } from "zod";

import { attachAudioOverlay, UploadPolicyError } from "@/lib/media-pipeline";
import { getSessionFromApi } from "@/lib/session";

// Owner-only gust "sound" attachment. Attaches an uploaded AUDIO media row to
// a VIDEO row as its audioOverlayId (the track that replaces the video's own
// audio during pipeline processing), or clears it with null. If derivatives
// were already generated the pipeline regenerates them with the new track.
const overlaySchema = z.object({
  audioOverlayId: z.string().min(1).max(64).nullable(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ mediaId: string }> }
): Promise<Response> {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { mediaId } = await context.params;
  if (!mediaId || mediaId.length > 64) {
    return Response.json({ error: "Invalid media id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = overlaySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "audioOverlayId must be a media id or null" },
      { status: 400 }
    );
  }

  try {
    const result = await attachAudioOverlay({
      audioOverlayId: parsed.data.audioOverlayId,
      mediaId,
      userId: user.id,
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof UploadPolicyError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
