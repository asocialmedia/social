import { prisma } from "@asm/db";
import type { Metadata } from "next";
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
    return (
      <p className="text-destructive">
        You&apos;re not authorized to view this page.
      </p>
    );
  }

  const userData = await getUserData(session.user.id);

  if (!userData) {
    return <p className="text-destructive">Unable to load user data.</p>;
  }

  const [postBookmarkCount, hnBookmarkCount] = await Promise.all([
    prisma.bookmark.count({
      where: { userId: session.user.id },
    }),
    prisma.hNBookmark.count({
      where: { userId: session.user.id },
    }),
  ]);

  return (
    <Suspense fallback={<CenteredLogoLoader size={64} />}>
      <Bookmarks
        hnBookmarkCount={hnBookmarkCount}
        postBookmarkCount={postBookmarkCount}
        userData={userData}
      />
    </Suspense>
  );
}
