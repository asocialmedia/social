"use client";
import type { ExternalPost } from "@asm/protocols/contracts";
import { externalReplyTarget } from "@asm/protocols/discovery";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { EyeOff, MoreHorizontal, VolumeX } from "lucide-react";

import { FEED_POST_ACTION } from "@/components/home/feedview/feed-post-surface";
import ShareButton from "@/components/home/feedview/share-button";
import AuraVoteButton from "@/components/posts/actions/aura-vote-button";
import BookmarkButton from "@/components/posts/actions/bookmark-button";
import { RespondAction } from "@/components/posts/actions/respond-action";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { getPostUrl } from "@/lib/posts/post-url";
import { useComposerStore } from "@/store/composer-store";

import { BlueskyIcon } from "./bluesky-icon";
import { ExternalLikeButton } from "./external-like-button";
import { useExternalFeedback } from "./use-external-feedback";
import { useExternalInteractions } from "./use-external-interactions";

export function ExternalVoteButton({
  post,
  layout,
}: {
  post: ExternalPost;
  layout?: "menu";
}) {
  const interaction = useExternalInteractions(post);
  const feedback = useExternalFeedback(post);
  const state = {
    aura: interaction.state.amplifications,
    userVote: interaction.state.amplified ? 1 : 0,
  };
  return (
    <AuraVoteButton
      engagement={<ExternalLikeButton post={post} />}
      likeCount={post.upstreamCounts.likes ?? null}
      layout={layout}
      authorName={post.author.displayName}
      initialState={state}
      postId={post.id}
      controller={{
        pending: interaction.pending,
        state,
        vote: (value) => {
          if (value === 1) {
            void interaction.mutate({
              action: "amplify",
              active: !interaction.state.amplified,
              uri: post.id,
            });
          } else {
            void feedback("post");
          }
        },
      }}
    />
  );
}
export function ExternalBookmarkButton({
  iconClassName,
  kind,
  post,
  className,
  layout,
}: {
  post: ExternalPost;
  iconClassName?: string;
  kind?: "post" | "gust";
  className?: string;
  layout?: "menu";
}) {
  const interaction = useExternalInteractions(post);
  const state = { isBookmarkedByUser: interaction.state.bookmarked };
  return (
    <BookmarkButton
      iconClassName={iconClassName}
      kind={kind}
      layout={layout}
      className={className}
      initialState={state}
      postId={post.id}
      controller={{
        pending: interaction.pending,
        state,
        toggle: () => {
          void interaction.mutate({
            action: "bookmark",
            active: !interaction.state.bookmarked,
            uri: post.id,
          });
        },
      }}
    />
  );
}
export function ExternalRespondButton({ post }: { post: ExternalPost }) {
  const auth = useRequireAuth();
  const openComposer = useComposerStore((state) => state.openComposer);
  const interaction = useExternalInteractions(post);
  return (
    <RespondAction
      count={interaction.state.responses ?? 0}
      onClick={() => {
        if (!auth.isLoggedIn) {
          auth.goToLogin();
          return;
        }
        openComposer("post", externalReplyTarget(post));
      }}
    />
  );
}
export function ExternalShareButton({
  post,
  className,
}: {
  post: ExternalPost;
  className?: string;
}) {
  return (
    <ShareButton
      className={className}
      defaultTab="link"
      description={post.text}
      dialogTitle="Share Post"
      shareUrl={getPostUrl({ external: post, id: post.id })}
      title={`${post.author.displayName} on asocialmedia`}
    />
  );
}
export function ExternalPostMenu({
  post,
  className,
  iconClassName,
}: {
  post: ExternalPost;
  className?: string;
  iconClassName?: string;
}) {
  const feedback = useExternalFeedback(post);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Post options"
          className={`${FEED_POST_ACTION} ${className ?? ""}`}
          type="button"
        >
          <MoreHorizontal className={iconClassName ?? "size-4 sm:size-4.5"} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-2xl! p-2">
        <DropdownMenuItem
          onSelect={() => {
            void feedback("post");
          }}
        >
          <EyeOff className="size-4" />
          Not interested
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void feedback("author");
          }}
        >
          <VolumeX className="size-4" />
          Mute author in asocialmedia
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={post.url} rel="noopener noreferrer" target="_blank">
            <BlueskyIcon tooltip={false} />
            Open on Bluesky
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
