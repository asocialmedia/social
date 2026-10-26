"use client";

import type { CommentData, PostData } from "@asm/db";
import { CornerDownRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserBadge from "@/components/layouts/user/user-badge";
import UserTooltip from "@/components/layouts/user/user-tooltip";
import AuraVoteButton from "@/components/posts/actions/aura-vote-button";
import PostLinkedContent from "@/components/posts/content/post-linked-content";
import { BlueskyIcon } from "@/components/protocols/bluesky-icon";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { blueskyProfilePath } from "@/lib/protocols/paths";
import type { Media } from "@/lib/types";
import { profilePath } from "@/lib/users/profile-path";
import { cn, formatRelativeDate } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

import {
  CommentAttachments,
  CommentAvatarFallback,
} from "../composer/comment-attachments";
import CommentInput from "../composer/comment-input";
import { MAX_COMMENT_DEPTH } from "../thread/comment-tree";
import type { CommentNode } from "../thread/comment-tree";
import { useCommentsRealtimeValue } from "../thread/comments-realtime-context";
import { CommentLinkEmbeds } from "./comment-link-embeds";
import CommentMoreButton from "./comment-more-button";

// Indent per nesting level (pl-8). The reply's avatar sits at this offset,
// giving replies room to the right of the parent's rail column.
const LEVEL_PAD = 32;
// The h-10 avatar is 40px tall/wide; its vertical center is 26px (6px pt-1.5 + 20px half).
const AVATAR_CENTER = 26;
// Column of the thread rail: centered in the indent channel (16px from the
// left edge and 16px to the reply avatar edge at LEVEL_PAD = 32).
const RAIL_X = LEVEL_PAD / 2;
// Generous curve radius matching the exact horizontal distance from the rail
// column (16px) to the reply avatar edge (32px), creating a perfect 90-degree
// smooth circular bend (start tangent vertical, end tangent horizontal).
const CURVE_RADIUS = LEVEL_PAD - RAIL_X;

type CommentWithExtras = CommentData & {
  attachments?: {
    id: string;
    type: Media["type"];
    mimeType?: string;
    thumbnailKey?: string | null;
  }[];
  source?: "asm" | "bluesky";
  votes?: { userId: string; value: number }[];
};

interface CommentItemProps {
  localActions?: {
    pending: boolean;
    delete: (commentId?: string) => Promise<boolean>;
  };
  applyCreated: (comment: CommentData) => void;
  applyDeleted: (comment: CommentData) => void;
  // Marks the last sibling so its rail segment terminates at the avatar center
  // (the connection point) instead of running the full height of the thread.
  isLast?: boolean;
  node: CommentNode;
  post: PostData | { id: string };
}

export default function CommentItem({
  applyCreated,
  applyDeleted,
  isLast = false,
  node,
  post,
  localActions,
}: CommentItemProps) {
  const { comment, children, depth } = node;
  const { user } = useSession();
  const { goToLogin, isLoggedIn } = useRequireAuth();
  const shared = useCommentsRealtimeValue();
  const [showReply, setShowReply] = useState(false);

  const commentWithExtras = comment as CommentWithExtras;
  const isBluesky =
    commentWithExtras.source === "bluesky" ||
    comment.id.startsWith("at://") ||
    (Boolean(comment.user?.id) && comment.user.id.startsWith("did:"));
  const commentUser = comment.user;
  const username = commentUser?.username ?? "unknown";
  const displayName = commentUser?.displayName || username;
  const isOwnComment = Boolean(user) && commentUser?.id === user?.id;
  const isDeleted = comment.deleted;
  const clampedDepth = Math.min(depth, MAX_COMMENT_DEPTH);
  const hasRail = clampedDepth > 0;

  const hasFloatingComposer = Boolean(shared?.hasFloatingComposer);

  // When a floating mobile composer is present (on the post detail page), route
  // mobile replies directly to it. Otherwise (home feed, explore, profile),
  // open the inline reply composer on all devices including mobile.
  const handleReplyOpen = useCallback(() => {
    if (!isLoggedIn) {
      goToLogin();
      return;
    }
    if (
      hasFloatingComposer &&
      typeof window !== "undefined" &&
      window.innerWidth < 1024
    ) {
      shared?.setReplyingTo({
        commentId: comment.id,
        content: comment.content,
        username,
      });
      return;
    }
    const next = !showReply;
    setShowReply(next);
    shared?.setReplyOpen(next);
  }, [
    comment.content,
    comment.id,
    goToLogin,
    hasFloatingComposer,
    isLoggedIn,
    shared,
    showReply,
    username,
  ]);

  useEffect(
    () => () => {
      if (showReply) {
        shared?.setReplyOpen(false);
      }
    },
    [shared, showReply]
  );

  let avatarNode = (
    <CommentAvatarFallback
      className="relative z-10 h-10 w-10"
      src={undefined}
    />
  );
  if (!comment.deleted && commentUser) {
    const avatarFallback = (
      <CommentAvatarFallback
        className="h-10 w-10"
        src={
          commentUser.avatarUrl
            ? getSecureImageUrl(commentUser.avatarUrl)
            : undefined
        }
      />
    );
    avatarNode = isBluesky ? (
      <Link
        aria-label={`View @${username}'s profile`}
        className="relative z-10 shrink-0"
        href={blueskyProfilePath(commentUser.id)}
      >
        {avatarFallback}
      </Link>
    ) : (
      <UserTooltip user={commentUser}>
        <Link
          aria-label={`View @${username}'s profile`}
          className="relative z-10 shrink-0"
          href={profilePath(username)}
        >
          {avatarFallback}
        </Link>
      </UserTooltip>
    );
  }

  return (
    <div
      className={cn(
        "group/comment relative transition-colors",
        hasRail && "pl-8"
      )}
    >
      {/* Rail connector: connects parent rail down to this reply's avatar.
          Terminates at avatar center on the last sibling; runs to 100% when
          more siblings follow below so they stay connected to the parent rail. */}
      {hasRail && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 overflow-visible"
          style={{
            height: isLast ? AVATAR_CENTER + 4 : "100%",
            width: LEVEL_PAD + 4,
          }}
        >
          {isLast ? (
            <path
              d={`M ${RAIL_X} -1 V ${AVATAR_CENTER - CURVE_RADIUS} A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 0 ${LEVEL_PAD} ${AVATAR_CENTER} H ${LEVEL_PAD + 2}`}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth="2"
            />
          ) : (
            <>
              <line
                stroke="hsl(var(--border))"
                strokeWidth="2"
                x1={RAIL_X}
                x2={RAIL_X}
                y1="-1"
                y2="100%"
              />
              <path
                d={`M ${RAIL_X} ${AVATAR_CENTER - CURVE_RADIUS} A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 0 ${LEVEL_PAD} ${AVATAR_CENTER} H ${LEVEL_PAD + 2}`}
                fill="none"
                stroke="hsl(var(--border))"
                strokeWidth="2"
              />
            </>
          )}
        </svg>
      )}

      {/* Stub: connects THIS comment's avatar down to its first reply's rail
          segment, so the thread line reads as hanging off the parent avatar. */}
      <div className="group/comment relative min-w-0 pt-2.5 pr-1 pb-2.5">
        {(children.length > 0 || showReply) && (
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute top-6 bottom-0 left-0 overflow-visible"
            style={{ height: "calc(100% - 24px + 2px)", width: RAIL_X + 4 }}
          >
            <line
              stroke="hsl(var(--border))"
              strokeWidth="2"
              x1={RAIL_X}
              x2={RAIL_X}
              y1="0"
              y2="100%"
            />
          </svg>
        )}
        <div className="flex gap-2.5">
          {avatarNode}

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              {isDeleted || !commentUser ? (
                <span className="text-muted-foreground text-xs font-medium">
                  [deleted]
                </span>
              ) : (
                <>
                  {isBluesky ? (
                    <Link
                      className="text-foreground truncate font-semibold hover:underline"
                      href={blueskyProfilePath(commentUser.id)}
                    >
                      {displayName}
                    </Link>
                  ) : (
                    <UserTooltip user={commentUser}>
                      <Link
                        className="text-foreground truncate font-semibold hover:underline"
                        href={profilePath(username)}
                      >
                        {displayName}
                      </Link>
                    </UserTooltip>
                  )}
                  {isBluesky ? (
                    <BlueskyIcon className="inline size-3.5 shrink-0 text-sky-500" />
                  ) : (
                    <UserBadge
                      badge={commentUser.badge}
                      badges={[...(commentUser.badges ?? [])]}
                      communityRoles={commentUser.communityMemberships}
                    />
                  )}
                  <Link
                    className="text-muted-foreground truncate hover:underline"
                    href={
                      isBluesky
                        ? blueskyProfilePath(commentUser.id)
                        : profilePath(username)
                    }
                  >
                    @{username}
                  </Link>
                </>
              )}
              <span className="text-muted-foreground shrink-0">·</span>
              <span
                className="text-muted-foreground shrink-0"
                suppressHydrationWarning
              >
                {formatRelativeDate(comment.createdAt)}
              </span>
            </div>

            {isDeleted ? (
              <p className="text-muted-foreground text-[15px] italic">
                This comment has been deleted.
              </p>
            ) : (
              <>
                <PostLinkedContent content={comment.content} />
                <CommentAttachments
                  attachments={commentWithExtras.attachments ?? []}
                />
                <CommentLinkEmbeds content={comment.content} />
              </>
            )}

            {!isDeleted && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {localActions ||
                isBluesky ||
                (typeof post?.id === "string" &&
                  post.id.startsWith("at://")) ? null : (
                  <>
                    <AuraVoteButton
                      authorName={displayName}
                      commentId={comment.id}
                      expandable={false}
                      initialState={{
                        aura: comment.aura ?? 0,
                        userVote: commentWithExtras.votes?.[0]?.value ?? 0,
                      }}
                      postId={post.id}
                    />
                    <button
                      aria-label="Reply to eddie"
                      className="pill-3d-hover text-muted-foreground inline-flex h-8 items-center gap-1 rounded-full border-0 px-2 text-xs font-medium active:translate-y-px"
                      onClick={handleReplyOpen}
                      type="button"
                    >
                      <CornerDownRight className="size-3.5" />
                      Reply
                    </button>
                  </>
                )}
                {isOwnComment && (
                  <CommentMoreButton
                    controller={
                      localActions
                        ? {
                            delete: () => localActions.delete(comment.id),
                            pending: localActions.pending,
                          }
                        : undefined
                    }
                    applyDeleted={applyDeleted}
                    className="h-7 w-7 rounded-full opacity-0 transition-opacity group-hover/comment:opacity-100"
                    comment={comment}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showReply && !isDeleted && (
        <div
          className={cn(
            "relative pt-1.5 pb-2.5 pl-8",
            hasFloatingComposer && "hidden lg:block"
          )}
        >
          {/* Rail connector for the reply composer: curves into composer avatar
              and continues down to subsequent siblings if children exist. */}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0 overflow-visible"
            style={{
              height: children.length === 0 ? AVATAR_CENTER + 4 : "100%",
              width: LEVEL_PAD + 4,
            }}
          >
            {children.length === 0 ? (
              <path
                d={`M ${RAIL_X} -1 V ${AVATAR_CENTER - CURVE_RADIUS} A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 0 ${LEVEL_PAD} ${AVATAR_CENTER} H ${LEVEL_PAD + 2}`}
                fill="none"
                stroke="hsl(var(--border))"
                strokeWidth="2"
              />
            ) : (
              <>
                <line
                  stroke="hsl(var(--border))"
                  strokeWidth="2"
                  x1={RAIL_X}
                  x2={RAIL_X}
                  y1="-1"
                  y2="100%"
                />
                <path
                  d={`M ${RAIL_X} ${AVATAR_CENTER - CURVE_RADIUS} A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 0 ${LEVEL_PAD} ${AVATAR_CENTER} H ${LEVEL_PAD + 2}`}
                  fill="none"
                  stroke="hsl(var(--border))"
                  strokeWidth="2"
                />
              </>
            )}
          </svg>
          <CommentInput
            applyCreated={applyCreated}
            autoFocus
            className="my-0"
            key={`reply-${comment.id}`}
            onCancel={() => {
              setShowReply(false);
              shared?.setReplyOpen(false);
            }}
            onSubmitted={() => {
              setShowReply(false);
              shared?.setReplyOpen(false);
            }}
            parentId={comment.id}
            placeholder={`Reply to @${username}...`}
            post={post}
            replyingTo={{ username }}
          />
        </div>
      )}

      {children.length > 0 && (
        <div className="space-y-0">
          {children.map((child, index) => (
            <CommentItem
              applyCreated={applyCreated}
              applyDeleted={applyDeleted}
              isLast={index === children.length - 1}
              key={child.comment.id}
              localActions={localActions}
              node={child}
              post={post}
            />
          ))}
        </div>
      )}
    </div>
  );
}
