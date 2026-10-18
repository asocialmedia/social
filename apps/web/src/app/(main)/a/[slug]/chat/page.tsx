import {
  canViewCommunity,
  getCommunityBySlug,
  listCommunityChatChannels,
} from "@asm/db";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { getSessionFromApi } from "@/lib/auth/session";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Community chat",
};

export default async function Page({ params }: PageProps) {
  await connection();
  const { slug } = await params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";
  const community = await getCommunityBySlug(slug);
  if (!community || !(await canViewCommunity(community, userId))) {
    notFound();
  }
  const { channels } = await listCommunityChatChannels(community.id, userId);
  const [firstChannel] = channels;
  if (!firstChannel) {
    notFound();
  }
  redirect(`/a/${community.slug}/chat/${firstChannel.id}`);
}
