"use client";

import CommunityChat from "./community-chat";
import { useCommunityWorkspace } from "./community-workspace-context";

export default function CommunityDensView({
  channelId,
  threadId,
}: {
  channelId: string;
  threadId?: string;
}) {
  const { community, membership, stats } = useCommunityWorkspace();

  return (
    <CommunityChat
      accentColor={community.accentColor}
      avatarUrl={community.avatarUrl}
      canReviewRequests={
        community.type !== "PUBLIC" &&
        membership?.status === "ACTIVE" &&
        (membership.role === "OWNER" || membership.role === "MODERATOR")
      }
      channelId={channelId}
      communityId={community.id}
      communityName={community.name}
      memberCount={stats.members}
      membership={membership}
      slug={community.slug}
      threadId={threadId}
    />
  );
}
