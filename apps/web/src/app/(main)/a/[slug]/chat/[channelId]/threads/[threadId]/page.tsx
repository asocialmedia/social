import {
  canViewCommunity,
  getCachedCommunityStats,
  getCommunityBySlug,
  getCommunityChatRoomAccess,
  getMembership,
  isSubscribedToCommunity,
} from "@asm/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import CommunityChatLoading from "@/components/communities/page/community-chat-loading";
import CommunityPage from "@/components/communities/page/community-page";
import { getSessionFromApi } from "@/lib/auth/session";
import { communityChatAvailabilityResponse } from "@/lib/communities/chat-api";
import { communityChatUiEnabled } from "@/lib/communities/chat-features";

interface PageProps {
  params: Promise<{ channelId: string; slug: string; threadId: string }>;
}

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Community thread",
};

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<CommunityChatLoading />}>
      <CommunityChatThreadPage {...props} />
    </Suspense>
  );
}

async function CommunityChatThreadPage({ params }: PageProps) {
  await connection();
  if (!communityChatUiEnabled || communityChatAvailabilityResponse()) {
    notFound();
  }
  const { channelId, slug, threadId } = await params;
  const [session, community] = await Promise.all([
    getSessionFromApi(),
    getCommunityBySlug(slug),
  ]);
  const userId = session?.user?.id ?? "";
  if (!community || !(await canViewCommunity(community, userId))) {
    notFound();
  }

  let channelAccess: Awaited<ReturnType<typeof getCommunityChatRoomAccess>>;
  let threadAccess: Awaited<ReturnType<typeof getCommunityChatRoomAccess>>;
  try {
    [channelAccess, threadAccess] = await Promise.all([
      getCommunityChatRoomAccess(channelId, userId),
      getCommunityChatRoomAccess(threadId, userId),
    ]);
  } catch {
    notFound();
  }
  if (
    channelAccess.communityId !== community.id ||
    channelAccess.room.kind !== "CHANNEL" ||
    threadAccess.communityId !== community.id ||
    threadAccess.room.kind !== "THREAD" ||
    threadAccess.room.parentRoomId !== channelId
  ) {
    notFound();
  }

  const [stats, membership, subscribed] = await Promise.all([
    getCachedCommunityStats(community.id),
    userId ? getMembership(community.id, userId) : Promise.resolve(null),
    userId
      ? isSubscribedToCommunity(community.id, userId)
      : Promise.resolve(false),
  ]);

  return (
    <CommunityPage
      channelId={channelId}
      community={community}
      membership={membership}
      slug={community.slug}
      stats={stats}
      subscribed={subscribed}
      threadId={threadId}
      view="chat"
    />
  );
}
