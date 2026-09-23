import { getPostDataInclude } from "../client";
import type { PostData } from "../client";
import { communityVisibilityWhere } from "../communities/visibility";
import prisma from "../prisma";
import { hydrateViewCounts } from "../redis";

const MAX_ANCESTOR_DEPTH = 20;

// Fetches the ancestor chain for a post from the root thread post down to the
// immediate parent in chronological order (oldest to newest).
// oxlint-disable no-await-in-loop -- sequential ancestry traversal where each parent lookup requires the previous parentPostId
export async function getPostAncestors(
  initialParentId: string,
  loggedInUserId: string
): Promise<PostData[]> {
  if (!initialParentId) {
    return [];
  }

  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE ancestor_tree AS (
        SELECT id, "parentPostId", 1 AS depth
        FROM posts
        WHERE id = ${initialParentId}
        UNION ALL
        SELECT p.id, p."parentPostId", a.depth + 1
        FROM posts p
        INNER JOIN ancestor_tree a ON p.id = a."parentPostId"
        WHERE a.depth < ${MAX_ANCESTOR_DEPTH}
      )
      SELECT id FROM ancestor_tree ORDER BY depth DESC;
    `;

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      return [];
    }

    // Ancestry is a reply's own thread, so it must honor community visibility
    // like any other read: a global reply can be visible while its parent sits
    // in a PRIVATE community the viewer cannot read, and returning that parent
    // would leak its content through a thread the reply is allowed to show.
    const posts = await prisma.post.findMany({
      include: getPostDataInclude(loggedInUserId),
      where: { id: { in: ids }, ...communityVisibilityWhere(loggedInUserId) },
    });

    const postMap = new Map(posts.map((p) => [p.id, p]));
    const ordered = ids
      .map((id) => postMap.get(id))
      .filter((p): p is PostData => Boolean(p));

    return hydrateViewCounts(ordered);
  } catch (error) {
    // Fallback in environments where recursive raw queries may fail or in tests
    console.warn(
      "Failed to fetch ancestors via CTE, falling back to loop:",
      error
    );
    let currentId: string | null = initialParentId;
    const ancestorIds: string[] = [];
    const visited = new Set<string>();

    while (currentId && ancestorIds.length < MAX_ANCESTOR_DEPTH) {
      if (visited.has(currentId)) {
        break;
      }
      visited.add(currentId);
      ancestorIds.push(currentId);

      const row: { parentPostId: string | null } | null =
        await prisma.post.findUnique({
          select: { parentPostId: true },
          where: { id: currentId },
        });
      currentId = row?.parentPostId ?? null;
    }

    if (ancestorIds.length === 0) {
      return [];
    }

    const posts = await prisma.post.findMany({
      include: getPostDataInclude(loggedInUserId),
      where: {
        id: { in: ancestorIds },
        ...communityVisibilityWhere(loggedInUserId),
      },
    });

    const postMap = new Map(posts.map((p) => [p.id, p]));
    const ordered = ancestorIds
      .toReversed()
      .map((id) => postMap.get(id))
      .filter((p): p is PostData => Boolean(p));

    return hydrateViewCounts(ordered);
  }
}
