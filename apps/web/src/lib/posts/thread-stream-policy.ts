import { z } from "zod";

import { explicitContentEnabled } from "./explicit-content-enabled";
import { commentsForReader, postsForReader } from "./reader-content-policy";

const contentSchema = z.looseObject({
  content: z.string().default(""),
  deleted: z.boolean().default(false),
  explicitContent: z.boolean().optional(),
  id: z.string(),
  moderated: z.boolean().optional(),
  semanticTags: z.array(z.string()).nullable().optional(),
});

export async function threadStreamContent(
  payload: unknown,
  viewerId: string,
  comment: boolean
) {
  const parsed = contentSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  const includeExplicit = await explicitContentEnabled(viewerId);
  if (comment) {
    const comments = await commentsForReader([parsed.data], includeExplicit);
    return comments[0];
  }
  const parentPost = contentSchema
    .nullable()
    .optional()
    .safeParse(parsed.data.parentPost);
  if (!parentPost.success) {
    return null;
  }
  return (
    postsForReader(
      [{ ...parsed.data, parentPost: parentPost.data }],
      includeExplicit
    )[0] ?? null
  );
}
