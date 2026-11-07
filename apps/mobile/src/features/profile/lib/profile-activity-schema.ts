import { externalPostSchema } from "@asm/protocols/discovery";
import { z } from "zod";

// Mirrors apps/web/src/lib/protocols/profile-activity-schema.ts. The web copy
// is app-local, so it cannot be imported here; keep the two in step until it
// moves into @asm/protocols.
export const profileActivityCursorSchema = z.object({
  at: z.iso.datetime(),
  id: z.string().min(1).max(128),
});

export const externalProfileActivityPageSchema = z.object({
  items: z.array(
    z.object({
      comment: z
        .object({
          content: z.string(),
          id: z.string(),
          user: z
            .object({
              avatarUrl: z.string().nullable(),
              displayName: z.string(),
              id: z.string(),
              username: z.string(),
            })
            .nullable(),
          withheld: z.boolean().optional(),
        })
        .optional(),
      createdAt: z.iso.datetime(),
      id: z.string(),
      post: externalPostSchema.nullable(),
      uri: z.string(),
    })
  ),
  nextCursor: profileActivityCursorSchema.nullable(),
});

export type ExternalProfileActivityPage = z.infer<
  typeof externalProfileActivityPageSchema
>;
export type ExternalProfileActivityItem =
  ExternalProfileActivityPage["items"][number];
export type ProfileActivityCursor = z.infer<typeof profileActivityCursorSchema>;
export type ExternalProfileActivityKind = "amplified" | "eddies";
