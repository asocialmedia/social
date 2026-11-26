import { listCommunityChatChannels } from "@asm/db";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import CommunityChatLoading from "@/components/communities/page/community-chat-loading";
import { communityChatAvailabilityResponse } from "@/lib/communities/chat-api";
import { communityChatUiEnabled } from "@/lib/communities/chat-features";
import { defaultCommunityChatChannel } from "@/lib/communities/chat-navigation";
import { getCommunityWorkspaceAccess } from "@/lib/communities/workspace-access";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Community chat",
};

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<CommunityChatLoading />}>
      <CommunityChatLanding {...props} />
    </Suspense>
  );
}

async function CommunityChatLanding({ params }: PageProps) {
  await connection();
  if (!communityChatUiEnabled || communityChatAvailabilityResponse()) {
    notFound();
  }
  const { slug } = await params;
  const { canRead, community, userId } =
    await getCommunityWorkspaceAccess(slug);
  if (!canRead) {
    redirect(`/a/${slug}`);
  }
  const { channels } = await listCommunityChatChannels(community.id, userId);
  const defaultChannel = defaultCommunityChatChannel(channels);
  if (!defaultChannel) {
    notFound();
  }
  return redirect(`/a/${community.slug}/chat/${defaultChannel.id}`);
}
