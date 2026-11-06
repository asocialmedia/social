import {
  canViewCommunity,
  getCommunityBySlug,
  listCommunityChatChannels,
} from "@asm/db";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import CommunityChatLoading from "@/components/communities/page/community-chat-loading";
import { getSessionFromApi } from "@/lib/auth/session";
import { communityChatAvailabilityResponse } from "@/lib/communities/chat-api";
import { communityChatUiEnabled } from "@/lib/communities/chat-features";

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
  const [session, community] = await Promise.all([
    getSessionFromApi(),
    getCommunityBySlug(slug),
  ]);
  const userId = session?.user?.id ?? "";
  if (!community) {
    notFound();
  }
  if (!(await canViewCommunity(community, userId))) {
    redirect(`/a/${slug}`);
  }
  const { channels } = await listCommunityChatChannels(community.id, userId);
  const [firstChannel] = channels;
  if (!firstChannel) {
    notFound();
  }
  return redirect(`/a/${community.slug}/chat/${firstChannel.id}`);
}
