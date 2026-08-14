"use client";

import type { CommentData, PostData } from "@asm/db";
import { CornerDownRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserTooltip from "@/components/layouts/user-tooltip";
import AuraVoteButton from "@/components/posts/aura-vote-button";
import Linkify from "@/helpers/global/linkify";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { formatRelativeDate } from "@/lib/utils";

import {
  CommentAttachments,
  CommentAvatarFallback,
} from "./comment-attachments";
import CommentInput from "./comment-input";
import CommentMoreButton from "./comment-more-button";
import { MAX_COMMENT_DEPTH } from "./comment-tree";
import type { CommentNode } from "./comment-tree";

// Tree gutter between the thread rail and the avatar, plus the avatar's
// vertical center used to anchor the SVG elbow connectors.
const LEVEL_PAD = 20;
const AVATAR_CENTER = 24;

interface CommentItemProps {
  applyCreated: (comment: CommentData) => void;
  applyDeleted: (comment: CommentData) => void;
  node: CommentNode;
  post: PostData;
}

export default function CommentItem({
  applyCreated,
  applyDeleted,
  node,
  post,
}: CommentItemProps) {
  const { comment, children, depth } = node;
  const { user } = useSession();
  const { goToLogin, isLoggedIn } = useRequireAuth();
  const [showReply, setShowReply] = useState(false);

  const isOwnComment = Boolean(user) && comment.user.id === user?.id;
  const isDeleted = comment.deleted;
  const clampedDepth = Math.min(depth, MAX_COMMENT_DEPTH);
  const hasRail = clampedDepth > 0;

  const handleReplyOpen = useCallback(() => {
    if (!isLoggedIn) {
      goToLogin();
      return;
    }
    setShowReply((prev) => !prev);
  }, [goToLogin, isLoggedIn]);

  return (
    <div
      className={hasRail ? "border-border/60 relative border-l" : "relative"}
    >
      {hasRail && (
        // Reddit-style SVG elbow: a horizontal connector from the thread rail
        // over to the avatar so every reply reads as visually anchored to its
        // parent. The rail itself is the continuous border-l running the full
        // height of the subtree.
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute top-0 h-full"
          style={{ left: 0, width: LEVEL_PAD }}
        >
          <path
            d={`M0 ${AVATAR_CENTER} H${LEVEL_PAD - 3}`}
            fill="none"
            stroke="hsl(var(--border))"
            strokeLinecap="round"
            strokeOpacity="0.65"
            strokeWidth="1.5"
          />
        </svg>
      )}

      <div
        className="group/comment min-w-0 pt-1.5 pr-1 pb-1.5"
        style={hasRail ? { paddingLeft: LEVEL_PAD } : undefined}
      >
        <div className="flex gap-2.5">
          {comment.deleted ? (
            <CommentAvatarFallback className="h-9 w-9" src={undefined} />
          ) : (
            <UserTooltip user={comment.user}>
              <Link
                className="shrink-0"
                href={`/users/${comment.user.username}`}
              >
                <CommentAvatarFallback
                  className="h-9 w-9"
                  src={comment.user.avatarUrl}
                />
              </Link>
            </UserTooltip>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              {isDeleted ? (
                <span className="text-muted-foreground font-medium">
                  [removed]
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
                This eddy has been removed.
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
                onSubmitted={() => setShowReply(false)}
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
        <div
          className="space-y-0.5"
          style={hasRail ? { paddingLeft: LEVEL_PAD } : undefined}
        >
          {children.map((child) => (
            <CommentItem
              applyCreated={applyCreated}
              applyDeleted={applyDeleted}
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
