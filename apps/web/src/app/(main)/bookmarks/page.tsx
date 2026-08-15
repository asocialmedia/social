import { prisma } from "@asm/db";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { CenteredLogoLoader } from "@/components/layouts/loaders/centered-logo-loader";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

import Bookmarks from "./bookmarks";

export const metadata: Metadata = {
  title: "Bookmarks",
};

export default async function Page() {
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
    <Suspense fallback={<CenteredLogoLoader size={64} />}>
      <Bookmarks
        gustBookmarkCount={gustBookmarkCount}
        hnBookmarkCount={hnBookmarkCount}
        postBookmarkCount={postBookmarkCount}
        userData={userData}
      />
    </Suspense>
  );
}
