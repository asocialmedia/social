import { z } from "zod";

import { ProtocolError } from "../contracts";
import type {
  ExternalAuthor,
  ExternalMedia,
  ExternalPost,
  ExternalThread,
  TextSegment,
} from "../contracts";
import { isAuthenticationNotice } from "./auth-feeds";
import { postViewSchema, threadViewPostSchema } from "./schemas";
import type { BlueskyPost, BlueskyProfile } from "./schemas";

export function safeLink(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function mediaLink(value: string | undefined): string | undefined {
  const link = safeLink(value);
  if (!link) {
    return undefined;
  }
  const { hostname } = new URL(link);
  return hostname.endsWith(".bsky.app") || hostname.endsWith(".bsky.network")
    ? link
    : undefined;
}

function publicLabels(
  labels: BlueskyProfile["labels"] = [],
  allowExplicitMedia = false
): string[] {
  const values = [
    ...new Set(
      (labels ?? [])
        .filter(
          (label) =>
            !label.neg && (!label.exp || Date.parse(label.exp) > Date.now())
        )
        .map((label) => label.val)
    ),
  ];
  // An explicit AI declaration is informational; all other labels keep the conservative visibility policy.
  if (
    values.some(
      (value) =>
        value !== "ai-generated" &&
        !(
          allowExplicitMedia &&
          ["porn", "sexual", "graphic-media", "nudity"].includes(value)
        )
    )
  ) {
    throw new ProtocolError(
      "restricted",
      "This content is not available through public discovery"
    );
  }
  return values;
}

function normalizeFacets(
  post: BlueskyPost
): NonNullable<ExternalPost["facets"]> {
  const result: NonNullable<ExternalPost["facets"]> = {
    links: [],
    mentions: [],
    tags: [],
  };
  const bytes = new TextEncoder().encode(post.record.text);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;
  for (const facet of [...post.record.facets].toSorted(
    (a, b) => a.index.byteStart - b.index.byteStart
  )) {
    const { byteStart, byteEnd } = facet.index;
    if (byteStart < offset || byteEnd <= byteStart || byteEnd > bytes.length) {
      continue;
    }
    try {
      decoder.decode(bytes.slice(byteStart, byteEnd));
    } catch {
      continue;
    }
    offset = byteEnd;
    for (const feature of facet.features) {
      if (
        feature.$type === "app.bsky.richtext.facet#tag" &&
        feature.tag &&
        feature.tag.length <= 640
      ) {
        result.tags.push(feature.tag);
      }
      if (feature.$type === "app.bsky.richtext.facet#mention" && feature.did) {
        result.mentions.push(feature.did);
      }
      const link =
        feature.$type === "app.bsky.richtext.facet#link"
          ? safeLink(feature.uri)
          : undefined;
      if (link) {
        result.links.push(link);
      }
    }
  }
  return {
    links: [...new Set(result.links)].slice(0, 1000),
    mentions: [...new Set(result.mentions)].slice(0, 1000),
    tags: [...new Set(result.tags)].slice(0, 1000),
  };
}

export function normalizeAuthor(
  profile: BlueskyProfile,
  allowExplicitMedia = false
): ExternalAuthor {
  const labels = publicLabels(profile.labels, allowExplicitMedia);
  return {
    avatarUrl: mediaLink(profile.avatar),
    bannerUrl: mediaLink(profile.banner),
    description: profile.description,
    displayName: profile.displayName || profile.handle,
    handle: profile.handle,
    id: profile.did,
    labels,
    source: "bluesky",
    upstreamCounts: {
      followers: profile.followersCount,
      following: profile.followsCount,
      posts: profile.postsCount,
    },
    url: `https://bsky.app/profile/${encodeURIComponent(profile.did)}`,
  };
}

export function normalizeSegments(post: BlueskyPost): TextSegment[] {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const bytes = new TextEncoder().encode(post.record.text);
  const segments: TextSegment[] = [];
  let offset = 0;
  const facets = [...post.record.facets].toSorted(
    (a, b) => a.index.byteStart - b.index.byteStart
  );
  for (const facet of facets) {
    const { byteStart, byteEnd } = facet.index;
    if (byteStart < offset || byteEnd <= byteStart || byteEnd > bytes.length) {
      continue;
    }
    const feature = facet.features.find(
      (value) =>
        value.$type === "app.bsky.richtext.facet#link" ||
        value.$type === "app.bsky.richtext.facet#mention"
    );
    const href =
      feature?.$type === "app.bsky.richtext.facet#mention" && feature.did
        ? `https://bsky.app/profile/${encodeURIComponent(feature.did)}`
        : safeLink(feature?.uri);
    if (!href) {
      continue;
    }
    try {
      const before = decoder.decode(bytes.slice(offset, byteStart));
      const text = decoder.decode(bytes.slice(byteStart, byteEnd));
      if (before) {
        segments.push({ text: before });
      }
      segments.push({ href, text });
      offset = byteEnd;
    } catch {
      continue;
    }
  }
  if (offset < bytes.length) {
    segments.push({ text: decoder.decode(bytes.slice(offset)) });
  }
  return segments;
}

const dimensions = z
  .object({
    height: z.number().int().positive().max(100_000),
    width: z.number().int().positive().max(100_000),
  })
  .optional();
const imagesSchema = z.object({
  images: z
    .array(
      z.object({
        alt: z.string().max(20_000),
        aspectRatio: dimensions,
        fullsize: z.string(),
        thumb: z.string().optional(),
      })
    )
    .max(4),
});
const videoSchema = z.object({
  alt: z.string().max(20_000).optional(),
  aspectRatio: dimensions,
  playlist: z.string(),
  thumbnail: z.string().optional(),
});
const embedTypeSchema = z.object({ $type: z.string() });

function normalizeMedia(embed: unknown): ExternalMedia[] {
  const type = embedTypeSchema.safeParse(embed);
  if (!type.success) {
    return [];
  }
  if (type.data.$type === "app.bsky.embed.images#view") {
    const parsed = imagesSchema.safeParse(embed);
    if (!parsed.success) {
      return [];
    }
    return parsed.data.images.flatMap((image) => {
      const url = mediaLink(image.fullsize);
      return url
        ? [
            {
              alt: image.alt,
              thumbnailUrl: mediaLink(image.thumb),
              type: "image" as const,
              url,
              ...image.aspectRatio,
            },
          ]
        : [];
    });
  }
  if (type.data.$type === "app.bsky.embed.video#view") {
    const parsed = videoSchema.safeParse(embed);
    if (!parsed.success) {
      return [];
    }
    const url = mediaLink(parsed.data.playlist);
    return url
      ? [
          {
            alt: parsed.data.alt ?? "",
            thumbnailUrl: mediaLink(parsed.data.thumbnail),
            type: "video",
            url,
            ...parsed.data.aspectRatio,
          },
        ]
      : [];
  }
  return [];
}

export function normalizePost(
  post: BlueskyPost,
  depth = 0,
  allowExplicitMedia = false
): ExternalPost {
  if (post.uri.slice(5).split("/")[0] !== post.author.did) {
    throw new ProtocolError(
      "invalid_response",
      "Post identity does not match its author"
    );
  }
  if (isAuthenticationNotice(post.record.text)) {
    throw new ProtocolError(
      "restricted",
      "This content requires authentication"
    );
  }
  const selfLabels = post.record.labels?.values.map((label) => label.val) ?? [];
  const labels = publicLabels(
    [...post.labels, ...selfLabels.map((val) => ({ val }))],
    allowExplicitMedia
  );
  const result: ExternalPost = {
    author: normalizeAuthor(post.author, allowExplicitMedia),
    createdAt: post.record.createdAt,
    facets: normalizeFacets(post),
    id: post.uri,
    indexedAt: post.indexedAt,
    labels,
    languages: post.record.langs,
    media: normalizeMedia(post.embed),
    replyRoot: post.record.reply?.root?.uri,
    replyTo: post.record.reply?.parent.uri,
    revision: post.cid,
    segments: normalizeSegments(post),
    selfLabels,
    source: "bluesky",
    tags: post.record.tags ?? [],
    text: post.record.text,
    upstreamCounts: {
      likes: post.likeCount,
      quotes: post.quoteCount,
      replies: post.replyCount,
      reposts: post.repostCount,
    },
    url: `https://bsky.app/profile/${encodeURIComponent(post.author.did)}/post/${post.uri.split("/").at(-1)}`,
  };
  const embedded = z
    .object({
      $type: z.string(),
      external: z
        .object({
          description: z.string().max(20_000),
          thumb: z.string().optional(),
          title: z.string().max(20_000),
          uri: z.string(),
        })
        .optional(),
      media: z.unknown().optional(),
      record: z.unknown().optional(),
    })
    .safeParse(post.embed);
  if (!embedded.success) {
    return result;
  }
  const { data } = embedded;
  if (data.$type === "app.bsky.embed.external#view" && data.external) {
    const url = safeLink(data.external.uri);
    if (url) {
      result.externalLink = {
        description: data.external.description,
        thumbnailUrl: mediaLink(data.external.thumb),
        title: data.external.title,
        url,
      };
    }
  }
  if (data.$type === "app.bsky.embed.recordWithMedia#view") {
    result.media = normalizeMedia(data.media);
  }
  if (
    data.$type === "app.bsky.embed.record#view" ||
    data.$type === "app.bsky.embed.recordWithMedia#view"
  ) {
    result.unavailableQuote = true;
    const wrapper = z.object({ record: z.unknown() }).safeParse(data.record);
    const candidate =
      data.$type === "app.bsky.embed.recordWithMedia#view" && wrapper.success
        ? wrapper.data.record
        : data.record;
    const quote = z
      .object({
        $type: z.literal("app.bsky.embed.record#viewRecord"),
        author: z.unknown(),
        cid: z.string(),
        embeds: z.array(z.unknown()).max(10).optional(),
        indexedAt: z.string(),
        labels: z.unknown().optional(),
        uri: z.string(),
        value: z.unknown(),
      })
      .safeParse(candidate);
    if (depth < 2 && quote.success) {
      const parsed = postViewSchema.safeParse({
        ...quote.data,
        embed: quote.data.embeds?.[0],
        record: quote.data.value,
      });
      if (parsed.success) {
        try {
          result.quote = normalizePost(
            parsed.data,
            depth + 1,
            allowExplicitMedia
          );
          result.unavailableQuote = false;
        } catch (error) {
          if (
            !(error instanceof ProtocolError && error.code === "restricted")
          ) {
            throw error;
          }
        }
      }
    }
  }
  return result;
}

export function extractThread(
  rawThread: unknown,
  maxReplies = 150,
  allowExplicitMedia = false
): ExternalThread {
  const parsed = threadViewPostSchema.safeParse(rawThread);
  if (!parsed.success) {
    return { post: null, replies: [] };
  }
  let post: ExternalPost | null = null;
  try {
    post = normalizePost(parsed.data.post, 0, allowExplicitMedia);
  } catch {
    return { post: null, replies: [] };
  }

  const replies: ExternalPost[] = [];
  const queue: unknown[] = [...(parsed.data.replies ?? [])];

  while (queue.length > 0 && replies.length < maxReplies) {
    const candidate = queue.shift();
    const validated = threadViewPostSchema.safeParse(candidate);
    if (!validated.success) {
      continue;
    }
    try {
      const normalized = normalizePost(
        validated.data.post,
        0,
        allowExplicitMedia
      );
      replies.push(normalized);
      if (Array.isArray(validated.data.replies)) {
        queue.push(...validated.data.replies);
      }
    } catch {
      // Content moderation / restricted label / format issues on a reply are safely skipped.
    }
  }

  return { post, replies };
}
