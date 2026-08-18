import { getUserDataSelect, prisma } from "@asm/db";
import { notFound, redirect } from "next/navigation";
import { cache, Suspense } from "react";

import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

import FollowersFollowingPage from "./followers-following-page";

interface PageProps {
  params: Promise<{ username: string }>;
}

const getUser = cache(async (username: string, loggedInUserId: string) => {
  const user = await prisma.user.findFirst({
    select: getUserDataSelect(loggedInUserId),
    where: {
      username: {
        equals: username,
        mode: "insensitive",
      },
    },
  });

  if (!user) {
    notFound();
  }

  return user;
});

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<FeedViewSkeleton />}>
      <FollowersContent params={props.params} />
    </Suspense>
  );
}

async function FollowersContent({ params }: PageProps) {
  const { username } = await params;
  const session = await getSessionFromApi();

  if (!session?.user) {
    redirect(`/login?next=/users/${encodeURIComponent(username)}/followers`);
  }

  const [userData, loggedInUserData] = await Promise.all([
    getUser(username, session.user.id),
    getUserData(session.user.id),
  ]);

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
