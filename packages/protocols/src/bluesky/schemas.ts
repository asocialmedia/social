import {
  AtUri,
  isAtIdentifierString,
  isAtUriString,
  isValidDid,
} from "@atproto/syntax";
import type {
  AtIdentifierString,
  AtUriString,
  DidString,
} from "@atproto/syntax";
import { z } from "zod";

export const didSchema = z
  .string()
  .max(2048)
  .pipe(z.custom<DidString>(isValidDid));
export const actorSchema = z
  .string()
  .max(2048)
  .pipe(z.custom<AtIdentifierString>(isAtIdentifierString));
function recordUriSchema(collection: string) {
  return z
    .string()
    .max(2300)
    .pipe(
      z.custom<AtUriString>((value) => {
        if (!isAtUriString(value)) {
          return false;
        }
        const uri = new AtUri(value);
        return (
          isValidDid(uri.hostname) &&
          uri.collection === collection &&
          Boolean(uri.rkey) &&
          !uri.search &&
          !uri.hash
        );
      })
    );
}
export const postUriSchema = recordUriSchema("app.bsky.feed.post");
export const feedUriSchema = recordUriSchema("app.bsky.feed.generator");
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const labelsSchema = z
  .array(z.object({ neg: z.boolean().optional(), val: z.string().max(256) }))
  .max(100)
  .default([]);
export const profileSchema = z.object({
  avatar: z.string().max(4096).optional(),
  banner: z.string().max(4096).optional(),
  description: z.string().max(20_000).optional(),
  did: didSchema,
  displayName: z.string().max(1000).optional(),
  followersCount: count.optional(),
  followsCount: count.optional(),
  handle: z.string().min(1).max(253),
  labels: labelsSchema,
  postsCount: count.optional(),
});
const facetSchema = z.object({
  features: z
    .array(
      z.object({
        $type: z.string(),
        did: didSchema.optional(),
        tag: z.string().optional(),
        uri: z.string().optional(),
      })
    )
    .max(10),
  index: z.object({
    byteEnd: z.number().int().min(0),
    byteStart: z.number().int().min(0),
  }),
});
export const postViewSchema = z.object({
  author: profileSchema,
  cid: z.string().min(1).max(512),
  embed: z.unknown().optional(),
  indexedAt: z.iso.datetime({ offset: true }),
  labels: labelsSchema,
  likeCount: count.default(0),
  quoteCount: count.default(0),
  record: z.object({
    $type: z.literal("app.bsky.feed.post"),
    createdAt: z.iso.datetime({ offset: true }),
    facets: z.array(facetSchema).max(1000).default([]),
    langs: z.array(z.string().max(64)).max(10).default([]),
    reply: z
      .object({ parent: z.object({ uri: z.string().max(2300) }) })
      .optional(),
    text: z.string().max(100_000),
  }),
  replyCount: count.default(0),
  repostCount: count.default(0),
  uri: postUriSchema,
});
export const feedPageSchema = z.object({
  cursor: z.string().max(4096).optional(),
  feed: z.array(z.object({ post: z.unknown() })).max(100),
});
export const postsSchema = z.object({ posts: z.array(z.unknown()).max(25) });
export type BlueskyProfile = z.infer<typeof profileSchema>;
export type BlueskyPost = z.infer<typeof postViewSchema>;
