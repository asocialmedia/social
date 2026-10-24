import { prisma } from "@asm/db";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import BookmarksSkeleton from "@/components/layouts/skeletons/bookmarks-skeleton";
import { getUserData } from "@/hooks/users/use-user-data";
import { getSessionFromApi } from "@/lib/auth/session";

import Bookmarks from "./bookmarks";

export const metadata: Metadata = {
  title: "Bookmarks",
};

export default function Page() {
  return (
    <Suspense fallback={<BookmarksSkeleton />}>
      <BookmarksContent />
    </Suspense>
  );
}

async function BookmarksContent() {
  // Claims the request before the first read. Prisma 8 stamps every query with
  // a crypto.randomUUID() plan id, and Cache Components fails a prerender that
  // touches an uncached value, so an unclaimed database read aborts the
  // prerender. headers() alone does not claim it: partial prefetching serves
  // runtime data during the shell render.
  await connection();

  const session = await getSessionFromApi();

  if (!session?.user) {
    redirect("/login");
  }

  const userData = await getUserData(session.user.id);

  if (!userData) {
    return <p className="text-destructive">Unable to load user data.</p>;
  }

  const [userBookmarks, hnBookmarkCount, externalBookmarkCount] =
    await Promise.all([
      // Fetch user's bookmarks with post's isGust flag to partition counts efficiently in memory
      prisma.orm.public.Bookmarks.where({ userId: session.user.id })
        .select("id")
        .include("post", (post) => post.select("isGust"))
        .all()
        .then(
          (items) => items,
          () => []
        ),
      prisma.orm.public.HNBookmark.where({ userId: session.user.id })
        .aggregate((aggregate) => ({ count: aggregate.count() }))
        .then((result) => result.count)
        .catch(() => 0),
      prisma.orm.public.ExternalEngagements.where({
        bookmarked: true,
        userId: session.user.id,
      })
        .aggregate((aggregate) => ({ count: aggregate.count() }))
        .then((result) => result.count)
        .catch(() => 0),
    ]);

  let postBookmarkCount = 0;
  let gustBookmarkCount = 0;
  for (const b of userBookmarks) {
    if (b.post?.isGust) {
      gustBookmarkCount += 1;
    } else {
      postBookmarkCount += 1;
    }
  }

  const totalPostBookmarks = postBookmarkCount + externalBookmarkCount;

  return (
    <Bookmarks
      gustBookmarkCount={gustBookmarkCount}
      hnBookmarkCount={hnBookmarkCount}
      postBookmarkCount={totalPostBookmarks}
      userData={userData}
    />
  );
}
