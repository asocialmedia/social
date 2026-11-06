import { externalPostSchema } from "@asm/protocols/discovery";
import { z } from "zod";

export const authorFeedPageSchema = z.object({
  cursor: z.string().nullable(),
  items: z.array(externalPostSchema).max(150),
});

// Filtering and pinned repeats can leave a short page while the author still has older posts.
export async function readAuthorFeedWindow(
  read: (cursor: string | null) => Promise<unknown>,
  cursor: string | null,
  known: ReadonlySet<string>
) {
  const items = new Map<string, z.infer<typeof externalPostSchema>>();
  const visited = new Set<string>();
  let next = cursor;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each page supplies the next author cursor.
    const page = authorFeedPageSchema.parse(await read(next));
    for (const post of page.items) {
      if (!known.has(post.id)) {
        items.set(post.id, post);
      }
    }
    const previous = next;
    next = page.cursor;
    if (!next || next === previous || visited.has(next) || items.size >= 30) {
      if (next === previous || (next && visited.has(next))) {
        next = null;
      }
      break;
    }
    visited.add(next);
  }
  return { cursor: next, items: [...items.values()] };
}
