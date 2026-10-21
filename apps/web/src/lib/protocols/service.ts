import "server-only";
import { readNetworkPreferences, filterExternalMediaSafety } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import {
  abortable,
  discoveryPageSchema,
  externalPostSchema,
  externalAuthorSchema,
  readJsonBounded,
  retryAfterMs,
} from "@asm/protocols/discovery";
import type { DiscoveryContent, DiscoveryMode } from "@asm/protocols/discovery";
import { context, propagation } from "@opentelemetry/api";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";

import { ProtocolGatewayError } from "./gateway";

async function applyViewerMediaPolicy(url: URL, includeExplicit?: boolean) {
  url.searchParams.delete("explicit");
  if (includeExplicit !== undefined) {
    if (includeExplicit) {
      url.searchParams.set("explicit", "1");
    }
    return;
  }
  const session = await getSessionFromApi();
  const settings = session?.user.id
    ? await readNetworkPreferences(session.user.id)
    : null;
  if (settings?.preferences.showExplicitContent) {
    url.searchParams.set("explicit", "1");
  }
}

export async function readBlueskySearch(
  query: string,
  signal: AbortSignal,
  requestId: string,
  kind: "all" | "user" | "post" = "all",
  includeExplicit?: boolean
) {
  const service = process.env.PROTOCOLS_SERVICE_URL;
  const token = process.env.PROTOCOLS_INTERNAL_TOKEN;
  if (!service || !token) {
    throw new ProtocolGatewayError(503, "not_configured");
  }
  const url = new URL("/v1/bluesky/search", service);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new ProtocolGatewayError(503, "invalid_configuration");
  }
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "6");
  url.searchParams.set("kind", kind);
  await applyViewerMediaPolicy(url, includeExplicit);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const response = await fetch(url, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "x-request-id": requestId },
    redirect: "error",
    signal: bounded,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProtocolGatewayError(
      response.status === 429 ? 429 : 503,
      "search_unavailable",
      Math.ceil(
        (retryAfterMs(response.headers.get("retry-after")) ?? 1000) / 1000
      )
    );
  }
  const result = z
    .object({
      posts: z.array(externalPostSchema).max(10),
      profiles: z.array(externalAuthorSchema).max(10),
      unavailable: z.array(z.enum(["profiles", "posts"])),
    })
    .parse(await readJsonBounded(response, 1024 * 1024, bounded));
  return {
    ...result,
    posts:
      url.searchParams.get("explicit") === "1"
        ? result.posts
        : await filterExternalMediaSafety(result.posts),
  };
}

export async function readBlueskyProfileResource(
  kind: "profile" | "author-feed",
  query: URLSearchParams,
  signal: AbortSignal,
  requestId: string,
  includeExplicit?: boolean
) {
  const service = process.env.PROTOCOLS_SERVICE_URL;
  const token = process.env.PROTOCOLS_INTERNAL_TOKEN;
  if (!service || !token) {
    throw new ProtocolGatewayError(503, "not_configured");
  }
  const url = new URL(`/v1/bluesky/${kind}`, service);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new ProtocolGatewayError(503, "invalid_configuration");
  }
  url.search = query.toString();
  if (includeExplicit === undefined) {
    await applyViewerMediaPolicy(url);
  } else {
    url.searchParams.delete("explicit");
    if (includeExplicit) {
      url.searchParams.set("explicit", "1");
    }
  }
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  const response = await abortable(
    fetch(url, {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}`, "x-request-id": requestId },
      redirect: "error",
      signal: boundedSignal,
    }),
    boundedSignal
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProtocolGatewayError(
      [400, 403, 404, 429].includes(response.status) ? response.status : 503,
      "profile_unavailable",
      Math.ceil(
        (retryAfterMs(response.headers.get("retry-after")) ?? 2000) / 1000
      )
    );
  }
  const data = await readJsonBounded(response, 2 * 1024 * 1024, boundedSignal);
  if (kind === "profile") {
    return externalAuthorSchema.parse(data);
  }
  const page = z
    .object({
      cursor: z.string().nullable(),
      items: z.array(externalPostSchema).max(50),
    })
    .parse(data);
  return {
    ...page,
    items:
      url.searchParams.get("explicit") === "1"
        ? page.items
        : await filterExternalMediaSafety(page.items),
  };
}

export async function readBlueskyDiscovery(
  mode: DiscoveryMode,
  cursor?: string,
  signal?: AbortSignal,
  requestId?: string,
  locale?: string,
  topics: string[] = [],
  includeExplicit = false,
  content: DiscoveryContent = "all"
) {
  const service = process.env.PROTOCOLS_SERVICE_URL;
  const token = process.env.PROTOCOLS_INTERNAL_TOKEN;
  if (!service || !token) {
    throw new ProtocolGatewayError(503, "not_configured", 30);
  }
  const url = new URL("/v1/bluesky/discover", service);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new ProtocolGatewayError(503, "invalid_configuration", 30);
  }
  url.searchParams.set("mode", mode);
  url.searchParams.set("content", content);
  if (includeExplicit) {
    url.searchParams.set("explicit", "1");
  }
  for (const topic of topics) {
    url.searchParams.append("topic", topic);
  }
  if (locale) {
    url.searchParams.set("locale", locale);
  }
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  const boundedSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    : AbortSignal.timeout(15_000);
  const traceHeaders: Record<string, string> = {};
  propagation.inject(context.active(), traceHeaders);
  const response = await abortable(
    fetch(url, {
      cache: "no-store",
      headers: {
        ...traceHeaders,
        authorization: `Bearer ${token}`,
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      redirect: "error",
      signal: boundedSignal,
    }),
    boundedSignal
  );
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 400 && cursor) {
      throw new ProtocolGatewayError(410, "expired_cursor");
    }
    const retry = Math.ceil(
      (retryAfterMs(response.headers.get("retry-after")) ?? 2000) / 1000
    );
    throw new ProtocolGatewayError(
      response.status === 429 ? 429 : 503,
      response.status === 401
        ? "internal_auth_rejected"
        : "upstream_unavailable",
      retry
    );
  }
  const page = discoveryPageSchema.safeParse(
    await readJsonBounded(response, 2 * 1024 * 1024, boundedSignal)
  );
  if (!page.success) {
    throw new ProtocolGatewayError(503, "invalid_upstream_response");
  }
  return page.data;
}

export async function readBlueskyPosts(
  uris: string[],
  signal?: AbortSignal,
  requestId?: string,
  recommendations = false
) {
  const service = process.env.PROTOCOLS_SERVICE_URL;
  const token = process.env.PROTOCOLS_INTERNAL_TOKEN;
  if (!service || !token) {
    throw new ProtocolGatewayError(503, "not_configured");
  }
  const url = new URL("/v1/bluesky/posts", service);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new ProtocolGatewayError(503, "invalid_configuration");
  }
  for (const uri of uris) {
    url.searchParams.append("uri", uri);
  }
  if (recommendations) {
    url.searchParams.set("recommendations", "1");
  }
  await applyViewerMediaPolicy(url);
  const boundedSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    : AbortSignal.timeout(15_000);
  const response = await abortable(
    fetch(url, {
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      redirect: "error",
      signal: boundedSignal,
    }),
    boundedSignal
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProtocolGatewayError(503, "upstream_unavailable");
  }
  const posts = z
    .array(externalPostSchema)
    .max(25)
    .parse(await readJsonBounded(response, 2 * 1024 * 1024, boundedSignal));
  return url.searchParams.get("explicit") === "1"
    ? posts
    : await filterExternalMediaSafety(posts);
}

export async function readBlueskyThread(
  uri: string,
  depth = 3,
  signal?: AbortSignal,
  requestId?: string
): Promise<{ post: ExternalPost | null; replies: ExternalPost[] }> {
  const service = process.env.PROTOCOLS_SERVICE_URL;
  const token = process.env.PROTOCOLS_INTERNAL_TOKEN;
  if (!service || !token) {
    throw new ProtocolGatewayError(503, "not_configured");
  }
  const url = new URL("/v1/bluesky/thread", service);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new ProtocolGatewayError(503, "invalid_configuration");
  }
  url.searchParams.set("uri", uri);
  await applyViewerMediaPolicy(url);
  if (depth !== undefined) {
    url.searchParams.set("depth", String(depth));
  }
  const boundedSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
    : AbortSignal.timeout(12_000);
  const response = await abortable(
    fetch(url, {
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      redirect: "error",
      signal: boundedSignal,
    }),
    boundedSignal
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProtocolGatewayError(503, "upstream_unavailable");
  }
  const parsed = z
    .object({
      post: externalPostSchema.nullable(),
      replies: z.array(externalPostSchema),
    })
    .safeParse(await readJsonBounded(response, 2 * 1024 * 1024, boundedSignal));
  if (!parsed.success) {
    throw new ProtocolGatewayError(503, "invalid_upstream_response");
  }
  if (url.searchParams.get("explicit") === "1") {
    return parsed.data;
  }
  const safe = await filterExternalMediaSafety([
    ...(parsed.data.post ? [parsed.data.post] : []),
    ...parsed.data.replies,
  ]);
  const allowed = new Set(safe.map((post) => post.id));
  return {
    post:
      parsed.data.post && allowed.has(parsed.data.post.id)
        ? parsed.data.post
        : null,
    replies: parsed.data.replies.filter((post) => allowed.has(post.id)),
  };
}

export async function verifyBlueskyFollowTarget(
  did: string,
  signal: AbortSignal
) {
  const service = process.env.PROTOCOLS_SERVICE_URL;
  const token = process.env.PROTOCOLS_INTERNAL_TOKEN;
  if (!service || !token) {
    throw new ProtocolGatewayError(503, "not_configured");
  }
  const url = new URL("/v1/bluesky/account-status", service);
  url.searchParams.set("actor", did);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(7000)]);
  const response = await fetch(url, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}` },
    redirect: "error",
    signal: bounded,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProtocolGatewayError(503, "status_unavailable");
  }
  const parsed = z
    .object({ status: z.string() })
    .safeParse(await readJsonBounded(response, 4096, bounded));
  if (!parsed.success || parsed.data.status === "unknown") {
    throw new ProtocolGatewayError(503, "status_unavailable");
  }
  if (parsed.data.status !== "active") {
    throw new ProtocolGatewayError(409, "author_inactive");
  }
}
