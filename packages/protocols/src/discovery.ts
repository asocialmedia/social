// Sequential retries share cancellation and never overlap attempts.
// oxlint-disable no-await-in-loop, promise/prefer-await-to-then
import { z } from "zod";

import type { ExternalPost } from "./contracts";
import {
  abortable,
  canRetryRead,
  FeedReadError,
  readJsonBounded,
  retryAfterMs,
  waitForReadRetry,
} from "./transport";

export {
  externalUriSchema,
  externalStateSchema,
  externalMutationSchema,
  externalCommentPageSchema,
  feedAvailability,
} from "./interactions";
export type { ExternalMutation, ExternalCommentPage } from "./interactions";

export type DiscoveryMode = "latest" | "personalized" | "trending";
export const discoveryLocaleSchema = z
  .string()
  .regex(
    /^(?:all|(?:ar|bn|de|el|en|es|fr|hi|id|it|ja|ko|mr|nl|pl|pt|ru|sv|ta|te|tr|uk|ur|vi|zh)(?:-[A-Z]{2})?)$/
  );
export const discoveryTopicsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[\p{L}\p{N} _-]+$/u)
  )
  .max(5);
export type FeedSource = "all" | "asm" | "bluesky";

export function externalReplyTarget(post: ExternalPost) {
  return {
    avatarUrl: post.author.avatarUrl ?? null,
    content: post.text,
    createdAt: post.createdAt,
    displayName: post.author.displayName,
    externalParentUri: post.id,
    id: post.id,
    username: post.author.handle,
  };
}

export const externalFeedbackSchema = z.object({
  authorId: z
    .string()
    .regex(/^did:[a-z]+:[A-Za-z0-9._:%-]+$/)
    .max(256),
  postId: z
    .string()
    .regex(/^at:\/\/did:[^/]+\/app\.bsky\.feed\.post\/[A-Za-z0-9._~-]+$/)
    .max(512),
  scope: z.enum(["post", "author"]),
});
export type ExternalFeedback = z.infer<typeof externalFeedbackSchema>;

export function externalFeedbackKey(feedback: ExternalFeedback): string {
  return `${feedback.scope}:${feedback.scope === "author" ? feedback.authorId : feedback.postId}`;
}

export function filterExternalRecommendations(
  posts: ExternalPost[],
  excluded: ReadonlySet<string>
): ExternalPost[] {
  return posts.filter(
    (post) =>
      !excluded.has(`post:${post.id}`) &&
      !excluded.has(`author:${post.author.id}`)
  );
}

const link = z
  .url()
  .refine((value) => ["https:", "http:"].includes(new URL(value).protocol));
const count = z.number().int().nonnegative();
export const externalAuthorSchema = z.object({
  avatarUrl: link.optional(),
  bannerUrl: link.optional(),
  description: z.string().optional(),
  displayName: z.string(),
  handle: z.string(),
  id: z.string(),
  labels: z.array(z.string()),
  source: z.literal("bluesky"),
  upstreamCounts: z.object({
    followers: count.optional(),
    following: count.optional(),
    posts: count.optional(),
  }),
  url: link,
});
export const externalPostSchema: z.ZodType<ExternalPost> = z.lazy(() =>
  z.object({
    asm: z
      .object({
        amplifications: count,
        amplified: z.boolean(),
        bookmarked: z.boolean(),
        comments: count,
        responses: count.optional(),
      })
      .optional(),
    author: externalAuthorSchema,
    createdAt: z.iso.datetime({ offset: true }),
    externalLink: z
      .object({
        description: z.string(),
        thumbnailUrl: link.optional(),
        title: z.string(),
        url: link,
      })
      .optional(),
    id: z.string().startsWith("at://"),
    indexedAt: z.iso.datetime({ offset: true }),
    labels: z.array(z.string()),
    languages: z.array(z.string()),
    media: z
      .array(
        z.object({
          alt: z.string(),
          height: z.number().optional(),
          thumbnailUrl: link.optional(),
          type: z.enum(["image", "video"]),
          url: link,
          width: z.number().optional(),
        })
      )
      .max(8),
    quote: externalPostSchema.optional(),
    replyTo: z.string().optional(),
    revision: z.string(),
    segments: z.array(z.object({ href: link.optional(), text: z.string() })),
    source: z.literal("bluesky"),
    text: z.string(),
    unavailableQuote: z.boolean().optional(),
    upstreamCounts: z.object({
      likes: count,
      quotes: count,
      replies: count,
      reposts: count,
    }),
    url: link,
  })
);
export const discoveryPageSchema = z.object({
  cursor: z.string().nullable(),
  items: z.array(externalPostSchema).max(50),
  partial: z.boolean(),
});
export type DiscoveryPage = z.infer<typeof discoveryPageSchema>;

export type MixedFeedItem<T> =
  | { kind: "asm"; id: string; value: T; createdAt: string }
  | { kind: "bluesky"; id: string; value: ExternalPost; createdAt: string };

export function mixFeedItems<T>(
  native: T[],
  external: ExternalPost[],
  options: {
    id: (item: T) => string;
    createdAt: (item: T) => string;
    latest: boolean;
    source: FeedSource;
  }
): MixedFeedItem<T>[] {
  const local: MixedFeedItem<T>[] =
    options.source === "bluesky"
      ? []
      : native.map((value) => ({
          createdAt: options.createdAt(value),
          id: `asm:${options.id(value)}`,
          kind: "asm",
          value,
        }));
  const remote: MixedFeedItem<T>[] =
    options.source === "asm"
      ? []
      : [...new Map(external.map((post) => [post.id, post])).values()].map(
          (value) => ({
            createdAt: value.createdAt,
            id: `bluesky:${value.id}`,
            kind: "bluesky",
            value,
          })
        );
  const result: MixedFeedItem<T>[] = [];
  if (options.latest) {
    // Insertion ordering also works on the app's Hermes runtime without toSorted.
    for (const item of [...local, ...remote]) {
      const timestamp = Math.min(Date.now(), Date.parse(item.createdAt) || 0);
      let index = result.length;
      while (
        index > 0 &&
        Math.min(
          Date.now(),
          Date.parse(result[index - 1]?.createdAt ?? "") || 0
        ) < timestamp
      ) {
        index -= 1;
      }
      result.splice(index, 0, item);
    }
    return result;
  }
  // Keep native ranking intact; outside content fills the feed as native activity grows.
  for (
    let index = 0;
    index < Math.max(local.length, Math.ceil(remote.length / 2));
    index += 1
  ) {
    const original = local[index];
    if (original) {
      result.push(original);
    }
    result.push(...remote.slice(index * 2, index * 2 + 2));
  }
  return result;
}

export const feedSourceLabels: Record<FeedSource, string> = {
  all: "All sources",
  asm: "ASM",
  bluesky: "Bluesky",
};
export const discoveryModeSchema = z.enum([
  "latest",
  "personalized",
  "trending",
]);
export function discoveryMode(variant: string): DiscoveryMode {
  if (variant === "latest") {
    return "latest";
  }
  if (variant === "trending") {
    return "trending";
  }
  return "personalized";
}

export {
  abortable,
  canRetryRead,
  FeedReadError,
  readJsonBounded,
  retryAfterMs,
  waitForReadRetry,
} from "./transport";

export async function readDiscoveryPage(options: {
  locale?: string;
  baseUrl?: string;
  mode: DiscoveryMode;
  cursor: string | null;
  signal: AbortSignal;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  wait?: typeof waitForReadRetry;
}): Promise<DiscoveryPage> {
  let { cursor } = options;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (options.signal.aborted) {
      throw new DOMException("Request cancelled", "AbortError");
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, options.timeoutMs ?? 18_000);
    try {
      const query = new URLSearchParams({ mode: options.mode });
      if (options.locale) {
        query.set("locale", options.locale);
      }
      if (cursor) {
        query.set("cursor", cursor);
      }
      const response = await abortable(
        (options.fetch ?? fetch)(
          `${options.baseUrl ?? ""}/api/protocols/bluesky/discover?${query}`,
          { cache: "no-store", signal: controller.signal }
        ),
        controller.signal
      );
      if (!response.ok) {
        void response.body?.cancel().catch(() => null);
        if (response.status === 410 && cursor) {
          cursor = null;
          continue;
        }
        throw new FeedReadError(
          response.status,
          retryAfterMs(response.headers.get("retry-after"))
        );
      }
      return discoveryPageSchema.parse(
        await readJsonBounded(response, 2 * 1024 * 1024, controller.signal)
      );
    } catch (error) {
      if (options.signal.aborted) {
        throw new DOMException("Request cancelled", "AbortError");
      }
      const failure = controller.signal.aborted
        ? new FeedReadError(408)
        : error;
      const delay = Math.max(
        failure instanceof FeedReadError ? failure.retryAfter : 0,
        500 * 2 ** attempt + Math.floor(Math.random() * 250)
      );
      if (!canRetryRead(failure) || attempt === 2 || delay > 5000) {
        throw failure;
      }
      clearTimeout(timer);
      // oxlint-disable-next-line no-await-in-loop -- retries must follow the failed attempt.
      await (options.wait ?? waitForReadRetry)(delay, options.signal);
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
    }
  }
  throw new FeedReadError(410);
}
