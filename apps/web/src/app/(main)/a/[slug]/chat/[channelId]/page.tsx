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

import CommunityPage from "@/components/communities/page/community-page";
import { getSessionFromApi } from "@/lib/auth/session";
import { communityChatAvailabilityResponse } from "@/lib/communities/chat-api";
import { communityChatUiEnabled } from "@/lib/communities/chat-features";

interface PageProps {
  params: Promise<{ channelId: string; slug: string }>;
}

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Community chat",
};

export default async function Page({ params }: PageProps) {
  await connection();
  if (!communityChatUiEnabled || communityChatAvailabilityResponse()) {
    notFound();
  }
  const { channelId, slug } = await params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";
  const community = await getCommunityBySlug(slug);
  if (!community || !(await canViewCommunity(community, userId))) {
    notFound();
  }

  let access: Awaited<ReturnType<typeof getCommunityChatRoomAccess>>;
  try {
    access = await getCommunityChatRoomAccess(channelId, userId);
  } catch {
    notFound();
  }
  if (access.communityId !== community.id || access.room.kind !== "CHANNEL") {
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
      view="chat"
    />
  );
}
