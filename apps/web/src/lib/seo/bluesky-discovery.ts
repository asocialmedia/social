import { and, or, filterExternalMediaSafety, prisma } from "@asm/db";
import { externalPostSchema } from "@asm/protocols/discovery";
import { cacheLife } from "next/cache";

// Only public participation makes a remote post discoverable here; visits and bookmarks do not.
export async function getPublicBlueskyDiscovery() {
  "use cache";
  cacheLife({ expire: 3600, revalidate: 300, stale: 60 });
  const rows = await prisma.orm.public.ExternalPosts.select("uri", "snapshot")
    .where((post) =>
      and(
        post.source.eq("bluesky"),
        post.available.eq(true),
        or(
          post.comments.some((comment) =>
            and(
              comment.deleted.eq(false),
              comment.user.some((user) => user.banned.eq(false))
            )
          ),
          post.engagements.some((entry) =>
            and(
              entry.amplified.eq(true),
              entry.user.some((user) => user.banned.eq(false))
            )
          )
        )
      )
    )
    .orderBy((post) => post.createdAt.desc())
    .limit(500)
    .all();
  const posts = rows.flatMap((row) => {
    const parsed = externalPostSchema.safeParse(row.snapshot);
    return parsed.success && parsed.data.id === row.uri ? [parsed.data] : [];
  });
  return await filterExternalMediaSafety(posts);
}
