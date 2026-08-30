import { consumeRateLimit, getClientIpFromHeaders } from "@asm/db";
import { NextResponse } from "next/server";

import { resolveLinkEmbed } from "@/lib/link-embeds/server";
import { sanitizeEmbedUrl } from "@/lib/link-embeds/shared";
import { getSessionFromApi } from "@/lib/session";

// Resolves one link into its embed payload for live previews and comment
// link cards. Per-user or per-IP rate limited: resolution costs an outbound
// fetch (cache misses) behind the SSRF guard and caches server-side.

const anonMemoryLimiter = new Map<string, { count: number; resetAt: number }>();
const ANON_LIMIT = 30;
const ANON_WINDOW_MS = 60_000;

function consumeAnonMemoryLimit(identifier: string): boolean {
  const now = Date.now();
  const entry = anonMemoryLimiter.get(identifier);
  if (!entry || now > entry.resetAt) {
    if (anonMemoryLimiter.size > 10_000) {
      for (const [key, value] of anonMemoryLimiter.entries()) {
        if (now > value.resetAt) {
          anonMemoryLimiter.delete(key);
        }
      }
    }
    anonMemoryLimiter.set(identifier, {
      count: 1,
      resetAt: now + ANON_WINDOW_MS,
    });
    return true;
  }
  if (entry.count >= ANON_LIMIT) {
    return false;
  }
  entry.count += 1;
  return true;
}

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const isAnonymous = !session?.user;
  const identifier =
    session?.user?.id ?? getClientIpFromHeaders(request.headers);
  const bucket = isAnonymous ? "link-preview-ip" : "link-preview-user";

  if (isAnonymous && !consumeAnonMemoryLimit(identifier)) {
    return Response.json({ error: "Slow down a little" }, { status: 429 });
  }

  const rate = await consumeRateLimit({
    bucket,
    identifier,
    limit: isAnonymous ? 30 : 60,
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
