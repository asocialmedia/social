import { prisma } from "@asm/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/session";

// Owner-only alt-text authoring. Alt text describes visual content for
// non-visual users; it must never be keyword-stuffed for SEO. Empty string
// clears a previously set value.
const altSchema = z.object({ altText: z.string().max(1000) });

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = altSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "altText is required (max 1000 chars)" },
      { status: 400 }
    );
  }

  const result = await prisma.media.updateMany({
    data: {
      altText: parsed.data.altText.trim() || null,
    },
    where: { id: mediaId, userId: user.id },
  });
  if (result.count === 0) {
    return Response.json({ error: "Media not found" }, { status: 404 });
  }
  return NextResponse.json({
    altText: parsed.data.altText.trim() || null,
    mediaId,
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ mediaId: string }> }
): Promise<Response> {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { mediaId } = await context.params;
  const media = await prisma.media.findUnique({
    select: {
      altText: true,
      id: true,
      ocrText: true,
      semanticTags: true,
      status: true,
      transcript: true,
      type: true,
      userId: true,
    },
    where: { id: mediaId },
  });

  if (!media || media.userId !== user.id) {
    return Response.json({ error: "Media not found" }, { status: 404 });
  }

  const isProcessing =
    media.status !== "READY" &&
    media.status !== "REJECTED" &&
    media.status !== "DELETED";

  // Generate suggested alt text based on available semantic enrichment
  let suggestedAlt = "";
  const tagsStr =
    media.semanticTags.length > 0
      ? media.semanticTags.slice(0, 5).join(", ")
      : "";

  if (media.type === "VIDEO") {
    if (media.transcript) {
      const cleanTranscript = media.transcript.trim();
      const maxLen = tagsStr ? 850 : 950;
      const snippet =
        cleanTranscript.length > maxLen
          ? `${cleanTranscript.slice(0, maxLen - 3)}...`
          : cleanTranscript;
      suggestedAlt = `Video with spoken dialogue: "${snippet}"`;
      if (tagsStr) {
        suggestedAlt += ` (Topics: ${tagsStr})`;
      }
    } else if (tagsStr) {
      suggestedAlt = `Video featuring ${tagsStr}`;
    }
  } else if (media.type === "IMAGE") {
    if (media.ocrText) {
      const cleanOcr = media.ocrText.trim();
      const maxLen = tagsStr ? 850 : 950;
      const snippet =
        cleanOcr.length > maxLen
          ? `${cleanOcr.slice(0, maxLen - 3)}...`
          : cleanOcr;
      suggestedAlt = `Image containing text: "${snippet}"`;
      if (tagsStr) {
        suggestedAlt += ` (Themes: ${tagsStr})`;
      }
    } else if (tagsStr) {
      suggestedAlt = `Image depicting ${tagsStr}`;
    }
  } else if (media.type === "AUDIO" && media.transcript) {
    const cleanTranscript = media.transcript.trim();
    const maxLen = 950;
    const snippet =
      cleanTranscript.length > maxLen
        ? `${cleanTranscript.slice(0, maxLen - 3)}...`
        : cleanTranscript;
    suggestedAlt = `Audio recording: "${snippet}"`;
  }

  return NextResponse.json({
    altText: media.altText,
    isProcessing: isProcessing && !suggestedAlt,
    mediaId: media.id,
    ocrText: media.ocrText,
    semanticTags: media.semanticTags,
    status: media.status,
    suggestedAlt: suggestedAlt.trim(),
    transcript: media.transcript,
  });
}
