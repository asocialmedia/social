import { getCommunityChatRoomAccess } from "@asm/db";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import CommunityChatLoading from "@/components/communities/page/community-chat-loading";
import CommunityDensView from "@/components/communities/page/community-dens-view";
import { communityChatAvailabilityResponse } from "@/lib/communities/chat-api";
import { communityChatUiEnabled } from "@/lib/communities/chat-features";
import { getCommunityWorkspaceAccess } from "@/lib/communities/workspace-access";

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
  const { canRead, community, userId } =
    await getCommunityWorkspaceAccess(slug);
  if (!canRead) {
    redirect(`/a/${slug}`);
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

  return <CommunityDensView channelId={channelId} threadId={threadId} />;
}
