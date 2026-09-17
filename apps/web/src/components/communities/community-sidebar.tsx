"use client";

import type { CommunityData, CommunityStats } from "@asm/db";

import SearchField from "@/components/layouts/search-field";
import SidebarFooterLinks from "@/components/layouts/sidebar-footer-links";
import type { CommunityRoleValue } from "@/lib/communities/client";

import CommunityAboutCard from "./community-about-card";
import { CommunityPeople } from "./community-people";
import { CommunityTopMembers } from "./community-top-members";

// The community page's right rail. Same column metrics and surface language as
// the home rail, so the two read as one system: search, then the cards that
// describe this community, closed by the shared colophon.
//
// Posting is NOT offered here: the community header already carries the
// Create post action for members, so a second control in the rail was a
// duplicate of it.
export default function CommunitySidebar({
  community,
  membership,
  stats,
}: {
  community: CommunityData;
  membership: {
    role: CommunityRoleValue;
    status: "ACTIVE" | "PENDING";
  } | null;
  stats: CommunityStats;
}) {
  const canModerate =
    membership?.status === "ACTIVE" &&
    (membership.role === "OWNER" || membership.role === "MODERATOR");

  return (
    <aside className="bg-background border-border/60 sticky top-0 z-30 hidden h-screen w-72 shrink-0 flex-col overflow-visible border-l px-2.5 pt-2.5 pb-6 xl:flex">
      <div className="shrink-0 pb-4">
        <SearchField />
      </div>

      <div className="hide-native-scrollbar flex flex-1 flex-col gap-4 overflow-y-auto">
        <CommunityAboutCard community={community} stats={stats} />

        <CommunityPeople
          canModerate={canModerate}
          communityId={community.id}
          communityType={community.type}
          slug={community.slug}
        />

        <CommunityTopMembers slug={community.slug} />

        <SidebarFooterLinks />
      </div>
    </aside>
  );
}
