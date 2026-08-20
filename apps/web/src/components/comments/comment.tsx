"use client";

import type { CommentData, PostData } from "@asm/db";
import { CornerDownRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserBadge from "@/components/layouts/user-badge";
import UserTooltip from "@/components/layouts/user-tooltip";
import AuraVoteButton from "@/components/posts/aura-vote-button";
import Linkify from "@/helpers/global/linkify";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { formatRelativeDate } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

import {
  CommentAttachments,
  CommentAvatarFallback,
} from "./comment-attachments";
import CommentInput from "./comment-input";
import CommentMoreButton from "./comment-more-button";
import { MAX_COMMENT_DEPTH } from "./comment-tree";
import type { CommentNode } from "./comment-tree";
import { useCommentsRealtimeValue } from "./comments-realtime-context";

// Indent per nesting level (pl-8). The reply's avatar sits at this offset,
// giving replies room to the right of the parent's rail column.
const LEVEL_PAD = 32;
// The h-9 avatar is 36px tall/wide; its vertical center is 24px (6px pt-1.5 + 18px half).
const AVATAR_CENTER = 24;
// Column of the thread rail: centered in the indent channel (16px from the
// left edge and 16px to the reply avatar edge at LEVEL_PAD = 32).
const RAIL_X = LEVEL_PAD / 2;
// Generous curve radius matching the exact horizontal distance from the rail
// column (16px) to the reply avatar edge (32px), creating a perfect 90-degree
// smooth circular bend (start tangent vertical, end tangent horizontal).
const CURVE_RADIUS = LEVEL_PAD - RAIL_X;

interface CommentItemProps {
  applyCreated: (comment: CommentData) => void;
  applyDeleted: (comment: CommentData) => void;
  // Marks the last sibling so its rail segment terminates at the avatar center
  // (the connection point) instead of running the full height of the thread.
  isLast?: boolean;
  node: CommentNode;
  post: PostData;
}

export default function CommentItem({
  applyCreated,
  applyDeleted,
  isLast = false,
  node,
  post,
}: CommentItemProps) {
  const { comment, children, depth } = node;
  const { user } = useSession();
  const { goToLogin, isLoggedIn } = useRequireAuth();
  const shared = useCommentsRealtimeValue();
  const [showReply, setShowReply] = useState(false);

  const isOwnComment = Boolean(user) && comment.user.id === user?.id;
  const isDeleted = comment.deleted;
  const clampedDepth = Math.min(depth, MAX_COMMENT_DEPTH);
  const hasRail = clampedDepth > 0;

  // Tell the page-level context when this reply composer is open so the mobile
  // floating bar hides while the user is typing a reply inline.
  const handleReplyOpen = useCallback(() => {
    if (!isLoggedIn) {
      goToLogin();
      return;
    }
    setShowReply((prev) => {
      const next = !prev;
      shared?.setReplyOpen(next);
      return next;
    });
  }, [goToLogin, isLoggedIn, shared]);

  return (
    <div
      className={`relative scroll-mt-4 ${hasRail ? "pl-8" : ""}`}
      id={`comment-${comment.id}`}
    >
      {/* Rail connector for this reply: A unified SVG drawing the continuous rail
          and rounded branch. Centered on the parent avatar column (RAIL_X = 16),
          it smoothly bends with a generous circular arc into this reply's
          avatar (at LEVEL_PAD = 32, AVATAR_CENTER = 24). If this is the last
          sibling, the stroke terminates cleanly at the avatar without extending
          past it. Otherwise, the through-rail continues down to subsequent siblings. */}
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
      <div className="group/comment relative min-w-0 pt-1.5 pr-1 pb-1.5">
        {children.length > 0 && (
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
          {comment.deleted ? (
            <CommentAvatarFallback
              className="relative z-10 h-9 w-9"
              src={undefined}
            />
          ) : (
            <UserTooltip user={comment.user}>
              <Link
                aria-label={`View @${comment.user.username}'s profile`}
                className="relative z-10 shrink-0"
                href={`/users/${comment.user.username}`}
              >
                <CommentAvatarFallback
                  className="h-9 w-9"
                  src={
                    comment.user.avatarUrl
                      ? getSecureImageUrl(comment.user.avatarUrl)
                      : undefined
                  }
                />
              </Link>
            </UserTooltip>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              {isDeleted ? (
                <span className="text-muted-foreground text-xs font-medium">
                  [deleted]
                </span>
              ) : (
                <>
                  <UserTooltip user={comment.user}>
                    <Link
                      className="text-foreground truncate font-semibold hover:underline"
                      href={`/users/${comment.user.username}`}
                    >
                      {comment.user.displayName}
                    </Link>
                  </UserTooltip>
                  <UserBadge
                    badge={comment.user.badge}
                    badges={comment.user.badges}
                  />
                  <Link
                    className="text-muted-foreground truncate hover:underline"
                    href={`/users/${comment.user.username}`}
                  >
                    @{comment.user.username}
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
                <p className="text-foreground max-w-full text-[15px] leading-relaxed wrap-break-word whitespace-pre-wrap">
                  <Linkify>{comment.content}</Linkify>
                </p>
                <CommentAttachments attachments={comment.attachments} />
              </>
            )}

            {!isDeleted && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <AuraVoteButton
                  authorName={comment.user.displayName}
                  commentId={comment.id}
                  expandable={false}
                  initialState={{
                    aura: comment.aura,
                    userVote: comment.votes[0]?.value || 0,
                  }}
                  postId={post.id}
                />
                <button
                  aria-label="Reply to eddy"
                  className="pill-3d-hover text-muted-foreground inline-flex h-8 items-center gap-1 rounded-full border-0 px-2 text-xs font-medium active:translate-y-px"
                  onClick={handleReplyOpen}
                  type="button"
                >
                  <CornerDownRight className="size-3.5" />
                  Reply
                </button>
                {isOwnComment && (
                  <CommentMoreButton
                    applyDeleted={applyDeleted}
                    className="h-7 w-7 rounded-full opacity-0 transition-opacity group-hover/comment:opacity-100"
                    comment={comment}
                  />
                )}
              </div>
            )}

            {showReply && !isDeleted && (
              <CommentInput
                applyCreated={applyCreated}
                autoFocus
                className="mt-1"
                key={`reply-${comment.id}`}
                onSubmitted={() => {
                  setShowReply(false);
                  shared?.setReplyOpen(false);
                }}
                parentId={comment.id}
                placeholder={`Reply to @${comment.user.username}...`}
                post={post}
                replyingTo={{ username: comment.user.username }}
              />
            )}
          </div>
        </div>
      </div>

      {children.length > 0 && (
        <div className="space-y-0">
          {children.map((child, index) => (
            <CommentItem
              applyCreated={applyCreated}
              applyDeleted={applyDeleted}
              isLast={index === children.length - 1}
              key={child.comment.id}
              node={child}
              post={post}
            />
          ))}
        </div>
      )}
    </div>
  );
}
