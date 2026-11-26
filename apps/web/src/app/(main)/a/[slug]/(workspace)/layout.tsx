import {
  getCachedCommunityStats,
  getCommunityPreview,
  getMembership,
  isSubscribedToCommunity,
} from "@asm/db";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import type { ReactNode } from "react";

import CommunityPage from "@/components/communities/page/community-page";
import CommunityPrivateLanding from "@/components/communities/page/community-private-landing";
import CommunityPageSkeleton from "@/components/layouts/skeletons/community-page-skeleton";
import { getCommunityWorkspaceAccess } from "@/lib/communities/workspace-access";

interface WorkspaceLayoutProps {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}

export default function Layout(props: WorkspaceLayoutProps) {
  return (
    <Suspense fallback={<CommunityPageSkeleton />}>
      <WorkspaceLayout {...props} />
    </Suspense>
  );
}

async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  await connection();
  const { slug } = await params;
  const { canRead, community, userId } =
    await getCommunityWorkspaceAccess(slug);

  if (!canRead) {
    const preview = await getCommunityPreview(slug, userId);
    if (!preview) {
      notFound();
    }
    return (
      <CommunityPrivateLanding initialPreview={preview} viewerId={userId} />
    );
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
      community={community}
      key={`${community.id}:${userId}`}
      membership={membership}
      slug={community.slug}
      stats={stats}
      subscribed={subscribed}
      viewerId={userId}
    >
      {children}
    </CommunityPage>
  );
}
