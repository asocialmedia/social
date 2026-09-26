import { and, prisma } from "@asm/db";
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

  const [postBookmarkCount, gustBookmarkCount, hnBookmarkCount] =
    await Promise.all([
      // Posts excludes gusts since they have their own tab/count.
      prisma.orm.public.Bookmarks.where((bookmark) =>
        and(
          bookmark.post.some((post) => post.isGust.eq(false)),
          bookmark.userId.eq(session.user.id)
        )
      )
        .aggregate((aggregate) => ({ count: aggregate.count() }))
        .then((result) => result.count),
      prisma.orm.public.Bookmarks.where((bookmark) =>
        and(
          bookmark.post.some((post) => post.isGust.eq(true)),
          bookmark.userId.eq(session.user.id)
        )
      )
        .aggregate((aggregate) => ({ count: aggregate.count() }))
        .then((result) => result.count),
      prisma.orm.public.HNBookmark.where({ userId: session.user.id })
        .aggregate((aggregate) => ({ count: aggregate.count() }))
        .then((result) => result.count),
    ]);

  return (
    <Bookmarks
      gustBookmarkCount={gustBookmarkCount}
      hnBookmarkCount={hnBookmarkCount}
      postBookmarkCount={postBookmarkCount}
      userData={userData}
    />
  );
}
