import { z } from "zod";

export const externalUriSchema = z
  .string()
  .max(512)
  .regex(
    /^at:\/\/did:(?:plc|web):[A-Za-z0-9._:%-]+\/app\.bsky\.feed\.post\/[A-Za-z0-9._~:-]+$/
  );
export const externalStateSchema = z.object({
  amplifications: z.number().int().nonnegative(),
  amplified: z.boolean(),
  bookmarked: z.boolean(),
  comments: z.number().int().nonnegative(),
  responses: z.number().int().nonnegative().optional(),
});
export const externalMutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.enum(["bookmark", "amplify"]),
      active: z.boolean(),
      uri: externalUriSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("comment"),
      content: z.string().trim().min(1).max(1500),
      requestId: z.uuid(),
      uri: externalUriSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("delete_comment"),
      commentId: z.uuid(),
      uri: externalUriSchema,
    })
    .strict(),
]);
export type ExternalMutation = z.infer<typeof externalMutationSchema>;

export const externalCommentSchema = z.object({
  content: z.string(),
  createdAt: z.string(),
  deleted: z.boolean(),
  id: z.string(),
  parentId: z.string().nullable().optional(),
  rootId: z.string().nullable().optional(),
  source: z.enum(["asm", "bluesky"]).default("asm"),
  uri: z.string().optional(),
  user: z.object({
    avatarUrl: z.string().nullable().optional(),
    displayName: z.string(),
    handle: z.string().optional(),
    id: z.string(),
    username: z.string(),
  }),
  userId: z.string(),
});
export type ExternalComment = z.infer<typeof externalCommentSchema>;

export const externalCommentPageSchema = z.object({
  cursor: z
    .object({ createdAt: z.string(), id: z.string() })
    .nullable()
    .nullish(),
  items: z.array(externalCommentSchema),
});
export type ExternalCommentPage = z.infer<typeof externalCommentPageSchema>;

export type FeedAvailability = "loading" | "error" | "empty" | "content";
export function feedAvailability(input: {
  count: number;
  nativeEnabled: boolean;
  externalEnabled: boolean;
  nativeLoading: boolean;
  externalLoading: boolean;
  nativeError: boolean;
  externalError: boolean;
}): FeedAvailability {
  if (input.count > 0) {
    return "content";
  }
  if (
    (input.nativeEnabled && input.nativeLoading) ||
    (input.externalEnabled && input.externalLoading)
  ) {
    return "loading";
  }
  if (
    (input.nativeEnabled && input.nativeError) ||
    (input.externalEnabled && input.externalError)
  ) {
    return "error";
  }
  return "empty";
}
