import {
  encodeTrendingCursor,
  fetchTrendingSnapshotPage,
  getPostDataInclude,
  hydrateViewCounts,
  prisma,
} from "@asm/db";
import type { PostsPage, Prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export async function GET(request: Request) {
  // Guests can browse the public feed; per-user fields simply resolve to empty.
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  // Explore opts out of moderated posts so its compact cards never show a
  // moderation row; the home feed still returns them.
  const excludeModerated = url.searchParams.get("excludeModerated") === "1";
  const pageSize = 20;

  // Primary path: the worker-published ZSET snapshot. A cursor pins one
  // generation, so a scroll keeps reading a frozen ranking even while newer
  // snapshots rotate in - no mid-scroll duplicates or skips like the old
  // order-by-a-mutating-column pagination had. Anything that went missing
  // from Postgres (deleted/moderated since publish) is filtered here and its
  // slot simply advances the cursor.
  let data: PostsPage | null = null;
  try {
    const snapshot = await fetchTrendingSnapshotPage({
      cursorRaw: cursor,
      pageSize,
    });
    if (snapshot) {
      const ids = snapshot.entries.map((entry) => entry.id);
      const rows = await prisma.post.findMany({
        include: getPostDataInclude(userId),
        where: { id: { in: ids } },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));

      const served: {
        entry: (typeof snapshot.entries)[number];
        row: PostRow;
      }[] = [];
      let consumedUpTo = -1;
      for (const [index, entry] of snapshot.entries.entries()) {
        if (served.length === pageSize) {
          break;
        }
        consumedUpTo = index;
        const row = byId.get(entry.id);
        // Vanished or newly moderated since the snapshot was published.
        if (!row || (excludeModerated && row.moderated)) {
          continue;
        }
        served.push({ entry, row });
      }

      const hydrated = await hydrateViewCounts(served.map((item) => item.row));
      const lastServed = served.at(-1);
      const mightContinue =
        consumedUpTo < snapshot.entries.length - 1 || snapshot.possiblyMore;
      const nextCursor =
        hydrated.length === pageSize &&
        lastServed !== undefined &&
        mightContinue
          ? encodeTrendingCursor({
              generation: snapshot.generation,
              postId: lastServed.entry.id,
              score: lastServed.entry.score,
            })
          : null;

      if (hydrated.length > 0 || nextCursor) {
        data = { nextCursor, posts: hydrated };
      }
      // Otherwise: unusable slice -> fall through to live Postgres below.
    }
  } catch {
    // Snapshot trouble (Redis down, bad generation) must never take the
    // trending feed down; the live ordering below is the safety net.
    data = null;
  }

  if (!data) {
    // No snapshot yet (fresh deploy), expired generation, Redis outage, or an
    // unservable slice: rank directly against the persisted scores.
    const where: Prisma.PostWhereInput = excludeModerated
      ? { isGust: false, moderated: false }
      : { isGust: false };

    const posts = await prisma.post.findMany({
      cursor: cursor ? { id: cursor } : undefined,
      include: getPostDataInclude(userId),
      // trendingScore is maintained by the worker's flush job; the id
      // tiebreak keeps equal scores deterministic.
      orderBy: [{ trendingScore: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      where,
    });

    const hydrated = await hydrateViewCounts(posts.slice(0, pageSize));
    data = {
      nextCursor: posts.length > pageSize ? posts[pageSize].id : null,
      posts: hydrated,
    };
  }

  const responseHeaders = userId
    ? { "cache-control": "private, no-cache", vary: "Cookie" }
    : {
        "cache-control": "public, s-maxage=15, stale-while-revalidate=45",
        vary: "Cookie",
      };

  return Response.json(data, { headers: responseHeaders });
}

type PostRow = Prisma.PostGetPayload<{
  include: ReturnType<typeof getPostDataInclude>;
}>;
