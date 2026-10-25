import { externalPostSchema } from "@asm/protocols/discovery";
import { z } from "zod";

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

export type ExternalProfileActivityItem = z.infer<
  typeof externalProfileActivityPageSchema
>["items"][number];
