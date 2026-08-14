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

// Indent per nesting level (pl-8). The reply's avatar sits at this offset,
// giving replies room to the right of the parent's rail column.
const LEVEL_PAD = 32;
// The h-9 avatar is 36px tall/wide; its horizontal center is 18px from the
// start of its row, and its vertical center is 24px (6px pt-1.5 + 18px half).
const AVATAR_HALF = 18;
const AVATAR_CENTER = 24;
// Column of the thread rail: the horizontal center of the parent avatar. The
// rail (a 2px line) is drawn at this column so it passes through the middle of
// the avatar it hangs from, and each reply's elbow runs from it to the avatar.
const RAIL_X = AVATAR_HALF;

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
    <div className={`relative ${hasRail ? "pl-8" : ""}`}>
      {/* Elbow: a rounded horizontal connector from the thread rail to this
          reply's avatar. It starts at the rail's center (no vertical tick, so
          nothing overlaps the rail) and ends a few px into the avatar column,
          tucking under the avatar (which sits on a higher z-index) so the
          connection reads as solid instead of ending at the rounded edge. */}
      {hasRail && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0"
          style={{ height: 48, width: LEVEL_PAD + 6 }}
        >
          <path
            d={`M${RAIL_X} ${AVATAR_CENTER} H${LEVEL_PAD + 3}`}
            fill="none"
            opacity="0.9"
            stroke="hsl(var(--border))"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
      )}

      {/* Rail segment for THIS reply: runs from the top of this reply down to
          the next sibling (full height), or terminates at the avatar center if
          this is the last sibling. The rail is centered on the parent avatar
          column and the elbow connects it to this avatar. */}
      {hasRail && (
        <span
          aria-hidden="true"
          className="absolute top-0 w-[2px] rounded-full bg-[hsl(var(--border))]/60"
          style={{
            left: RAIL_X - 1,
            ...(isLast ? { height: AVATAR_CENTER } : { bottom: 0 }),
          }}
        />
      )}

      {/* Stub: connects THIS comment's avatar down to its first reply's rail
          segment, so the thread line reads as hanging off the parent avatar. */}
      <div className="group/comment relative min-w-0 pt-1.5 pr-1 pb-1.5">
        {children.length > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-6 bottom-0 w-[2px] rounded-full bg-[hsl(var(--border))]/60"
            style={{ left: RAIL_X - 1 }}
          />
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
                className="relative z-10 shrink-0"
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
