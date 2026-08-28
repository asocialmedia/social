import { NextResponse } from "next/server";
import { z } from "zod";

import { UploadPolicyError, attachCustomThumbnail } from "@/lib/media-pipeline";
import { getSessionFromApi } from "@/lib/session";

// Owner-only gust thumbnail attachment. The uploaded IMAGE media row's
// verified bytes are copied into the video's key space and preferred by the
// thumbnail serving route over the pipeline's generated poster; null clears
// the custom cover.
const thumbnailSchema = z.object({
  thumbnailMediaId: z.string().min(1).max(64).nullable(),
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
  const parsed = thumbnailSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "thumbnailMediaId must be a media id or null" },
      { status: 400 }
    );
  }

  try {
    const result = await attachCustomThumbnail({
      mediaId,
      thumbnailMediaId: parsed.data.thumbnailMediaId,
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
