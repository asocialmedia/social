"use client";

import { Button } from "@asm/ui/shadui/button";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useSession } from "@/app/(main)/session-provider";
import { LinkStatusHint } from "@/components/layouts/feedback/link-status-hint";
import { communityChatChannelsQuery } from "@/lib/communities/chat-channels-query";

import CommunityChannelListHeader from "./community-channel-list-header";
import {
  communityNavigationChatIconClassName,
  communityNavigationRowClassName,
} from "./community-workspace-navigation";

export default function CommunityChannelShortcuts({
  channelId,
  slug,
}: {
  channelId?: string;
  slug: string;
}) {
  const { user } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = communityChatChannelsQuery(slug, user?.id);
  const { data, isPending, isError, refetch } = useQuery(query);
  const channels = data?.channels ?? [];
  return (
    <div className="hide-native-scrollbar min-h-0 flex-1 overflow-y-auto pb-3">
      <CommunityChannelListHeader
        count={data?.channels.length}
        onCreated={
          data?.permissions.canManage
            ? (channel) => {
                queryClient.setQueryData(query.queryKey, {
                  ...data,
                  channels: [...channels, channel],
                });
                router.push(`/a/${slug}/chat/${channel.id}`, { scroll: false });
              }
            : undefined
        }
        slug={slug}
      />
      <div className="px-2">
        {isPending ? (
          <output aria-label="Loading channels" className="block space-y-2">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </output>
        ) : null}
        {isError ? (
          <div className="space-y-2 px-2">
            <p className="text-muted-foreground text-sm">
              Couldn’t load channels.
            </p>
            <Button
              className="min-h-11"
              variant="premium-neutral"
              onClick={() => refetch()}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {data && channels.length === 0 ? (
          <p className="text-muted-foreground px-2 text-sm">
            No channels are available.
          </p>
        ) : null}
        {channels.map((channel) => (
          <Link
            aria-current={channel.id === channelId ? "page" : undefined}
            key={channel.id}
            href={`/a/${slug}/chat/${channel.id}`}
            scroll={false}
            className={communityNavigationRowClassName(
              channel.id === channelId
            )}
          >
            <MessageCircle
              aria-hidden="true"
              className={communityNavigationChatIconClassName(
                channel.id === channelId
              )}
            />
            <span className="min-w-0 flex-1 truncate">{channel.name}</span>
            <LinkStatusHint className="shrink-0" />
            {channel.channelType === "ANNOUNCEMENT" ? (
              <span className="text-muted-foreground/75 shrink-0 text-[10px] font-medium">
                Staff
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
