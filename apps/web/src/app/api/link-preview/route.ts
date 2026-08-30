import { consumeRateLimit, getClientIpFromHeaders } from "@asm/db";
import { NextResponse } from "next/server";

import { resolveLinkEmbed } from "@/lib/link-embeds/server";
import { sanitizeEmbedUrl } from "@/lib/link-embeds/shared";
import { getSessionFromApi } from "@/lib/session";

// Resolves one link into its embed payload for live previews and comment
// link cards. Per-user or per-IP rate limited: resolution costs an outbound
// fetch (cache misses) behind the SSRF guard and caches server-side.

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const identifier =
    session?.user?.id ?? getClientIpFromHeaders(request.headers);
  const bucket = session?.user ? "link-preview-user" : "link-preview-ip";

  const rate = await consumeRateLimit({
    bucket,
    identifier,
    limit: session?.user ? 60 : 30,
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
