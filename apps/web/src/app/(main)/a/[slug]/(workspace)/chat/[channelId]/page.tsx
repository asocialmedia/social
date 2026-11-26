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
  params: Promise<{ channelId: string; slug: string }>;
}

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Community chat",
};

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<CommunityChatLoading />}>
      <CommunityChatChannelPage {...props} />
    </Suspense>
  );
}

async function CommunityChatChannelPage({ params }: PageProps) {
  await connection();
  if (!communityChatUiEnabled || communityChatAvailabilityResponse()) {
    notFound();
  }
  const { channelId, slug } = await params;
  const { canRead, community, userId } =
    await getCommunityWorkspaceAccess(slug);
  if (!canRead) {
    redirect(`/a/${slug}`);
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

  return <CommunityDensView channelId={channelId} />;
}
