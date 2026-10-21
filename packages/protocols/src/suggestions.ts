import { z } from "zod";

export const recommendedAccountSchema = z.object({
  avatarUrl: z.string().nullable(),
  bannerUrl: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  displayName: z.string(),
  followers: z.number().nonnegative(),
  following: z.boolean(),
  handle: z.string(),
  href: z.string(),
  id: z.string(),
  reason: z.string(),
  source: z.enum(["asm", "bluesky"]),
});
export const recommendedPostSchema = z.object({
  authorId: z.string(),
  avatarUrl: z.string().nullable(),
  displayName: z.string(),
  href: z.string(),
  id: z.string(),
  reason: z.string(),
  source: z.enum(["asm", "bluesky"]),
  subtitle: z.string(),
});
export const discoverySuggestionsSchema = z.object({
  accounts: z.array(recommendedAccountSchema).max(12),
  partial: z.boolean(),
  posts: z.array(recommendedPostSchema).max(12),
  profileId: z.string(),
});
export type RecommendedAccount = z.infer<typeof recommendedAccountSchema>;
export type RecommendedPost = z.infer<typeof recommendedPostSchema>;
export type DiscoverySuggestions = z.infer<typeof discoverySuggestionsSchema>;
