import { consumeRateLimit } from "@asm/db";
import { NextResponse } from "next/server";

import { resolveLinkEmbed } from "@/lib/link-embeds/server";
import { sanitizeEmbedUrl } from "@/lib/link-embeds/shared";
import { getSessionFromApi } from "@/lib/session";

// Resolves one link into its embed payload for the post editor's live
// preview. Session-gated so this cannot be used as an open scraping proxy,
// and per-user rate limited: resolution costs an outbound fetch (cache
// misses) that an anonymous scripted loop could otherwise turn into a
// bandwidth amplifier.

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rate = await consumeRateLimit({
    bucket: "link-preview-user",
    identifier: session.user.id,
    limit: 30,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return Response.json({ error: "Slow down a little" }, { status: 429 });
  }

  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return Response.json({ error: "url is required" }, { status: 400 });
  }
  const sanitized = sanitizeEmbedUrl(url);
  if (!sanitized) {
    return Response.json(
      { error: "Only http(s) links can be previewed" },
      { status: 422 }
    );
  }

  const embed = await resolveLinkEmbed(sanitized);
  if (!embed) {
    return Response.json(
      { error: "No preview could be generated for this link" },
      { status: 422 }
    );
  }
  return NextResponse.json(
    { embed },
    // Resolved payloads are cached server-side; clients may pin them too.
    { headers: { "Cache-Control": "private, max-age=1800" } }
  );
}
