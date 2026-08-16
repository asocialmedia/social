import { prisma } from "@asm/db";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import AppShellSkeleton from "@/components/layouts/skeletons/app-shell-skeleton";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

import Bookmarks from "./bookmarks";

export const metadata: Metadata = {
  title: "Bookmarks",
};

export default function Page() {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <BookmarksContent />
    </Suspense>
  );
}

async function BookmarksContent() {
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
      prisma.bookmark.count({
        where: { post: { isGust: false }, userId: session.user.id },
      }),
      prisma.bookmark.count({
        where: { post: { isGust: true }, userId: session.user.id },
      }),
      prisma.hNBookmark.count({
        where: { userId: session.user.id },
      }),
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
