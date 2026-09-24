import {
  getUserDataQuery,
  mapUserData,
  prisma,
  resolveUsername,
} from "@asm/db";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import { getUserData } from "@/hooks/users/use-user-data";
import { getSessionFromApi } from "@/lib/auth/session";

import FollowersFollowingPage from "./followers-following-page";

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
};

interface PageProps {
  params: Promise<{ username: string }>;
}

const getUser = cache(async (username: string, loggedInUserId: string) => {
  const resolvedUsername = await resolveUsername(username);
  if (!resolvedUsername) {
    notFound();
  }

  const userRow = await getUserDataQuery(prisma.orm, loggedInUserId)
    .where({ id: resolvedUsername.id })
    .first();
  const user = userRow ? mapUserData(userRow) : null;

  if (!user) {
    notFound();
  }

  return { redirectToCurrentUsername: resolvedUsername.isAlias, user };
});

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<FeedViewSkeleton />}>
      <FollowersContent params={props.params} />
    </Suspense>
  );
}

async function FollowersContent({ params }: PageProps) {
  await connection();
  const { username } = await params;
  const session = await getSessionFromApi();

  if (!session?.user) {
    redirect(`/login?next=/users/${encodeURIComponent(username)}/followers`);
  }

  const [resolvedUser, loggedInUserData] = await Promise.all([
    getUser(username, session.user.id),
    getUserData(session.user.id),
  ]);

  if (resolvedUser.redirectToCurrentUsername) {
    redirect(
      `/users/${encodeURIComponent(resolvedUser.user.username)}/followers`
    );
  }
  const userData = resolvedUser.user;

  if (!loggedInUserData) {
    redirect(`/login?next=/users/${encodeURIComponent(username)}/followers`);
  }

  return (
    <FollowersFollowingPage
      loggedInUserData={loggedInUserData}
      userData={userData}
    />
  );
}
