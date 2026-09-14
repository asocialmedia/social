"use client";

import type { PostData, TagWithCount, UserData } from "@asm/db";
import { CornerDownRight } from "lucide-react";
import Link from "next/link";

// eslint-disable-next-line import/no-cycle -- response rows render media-previews, whose viewer surfaces related posts via post-card, which renders responses
import { MediaPreviews } from "@/components/home/feedview/media-previews";
import UserAvatar from "@/components/layouts/user-avatar";
import UserBadge from "@/components/layouts/user-badge";
import UserTooltip from "@/components/layouts/user-tooltip";
import AuraVoteButton from "@/components/posts/aura-vote-button";
import PostLinkEmbeds from "@/components/posts/link-embeds";
import ModeratedNotice from "@/components/posts/moderated-notice";
import PostLinkedContent from "@/components/posts/post-linked-content";
import { PostMeta } from "@/components/tags/post-meta";
import { parseStoredEmbeds } from "@/lib/link-embeds/shared";
import { normalizePostData } from "@/lib/posts/post-normalize";
import { getPostPath } from "@/lib/seo/seo";
import { formatRelativeDate } from "@/lib/utils";

import ResponseParentCard from "./response-parent-card";
import { MAX_RESPONSE_DEPTH } from "./response-tree";
import type { ResponseNode } from "./response-tree";

// Twitter-style thread geometry: a straight vertical line drops from the
// centre of each avatar down to the next reply's avatar. No curves, no
// horizontal rules between replies: the line is the thread.
const AVATAR_SIZE = 40;
// flex gap-2.5 between avatar and content
const INDENT = 32; // horizontal offset per nesting level
// 2px line centred under the avatar (avatar centre = 20px).
const LINE_WIDTH = 2;
const LINE_LEFT = AVATAR_SIZE / 2 - LINE_WIDTH / 2;
// Small breathing room between the avatar and the top of the line.
const LINE_TOP = AVATAR_SIZE + 6;

interface ResponseItemProps {
  // Marks the last sibling so its connector line stops instead of running on.
  isLast?: boolean;
  node: ResponseNode;
  onRespond: (response: PostData) => void;
}

export default function ResponseItem({
  isLast = false,
  node,
  onRespond,
}: ResponseItemProps) {
  const { children, depth, response } = node;
  const author = response.user;
  const username = author?.username ?? "unknown";
  const displayName = author?.displayName || username;
  const clampedDepth = Math.min(depth, MAX_RESPONSE_DEPTH);
  const indent = clampedDepth * INDENT;
  // The line continues while there is anything below this reply: a nested
  // child and/or a following sibling.
  const continues = children.length > 0 || !isLast;
  const embeds = parseStoredEmbeds(response.embeds);
  const attachments = response.attachments ?? [];
  // normalizePostData heals viewer-scoped joins that can be lost in transit; it
  // is a no-op on a well-formed row.
  const post = normalizePostData(response) as PostData;

  return (
    <div
      className="relative scroll-mt-4 pb-2.5"
      id={`response-${response.id}`}
      style={{ paddingLeft: indent }}
    >
      {continues && (
        <span
          aria-hidden="true"
          className="bg-border pointer-events-none absolute rounded-full"
          style={{
            bottom: 0,
            left: indent + LINE_LEFT,
            top: LINE_TOP,
            width: LINE_WIDTH,
          }}
        />
      )}

      <div className="flex gap-2.5 pr-1">
        {author ? (
          <UserTooltip user={author}>
            <Link
              aria-label={`View @${username}'s profile`}
              className="relative z-10 shrink-0"
              href={`/users/${username}`}
            >
              <UserAvatar
                className="h-10 w-10 bg-[hsl(var(--background-alt))]"
                size={AVATAR_SIZE}
                user={author}
              />
            </Link>
          </UserTooltip>
        ) : (
          <UserAvatar
            className="relative z-10 h-10 w-10 bg-[hsl(var(--background-alt))] opacity-60"
            seed={response.id}
            size={AVATAR_SIZE}
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <UserTooltip user={author}>
              <Link
                className="text-foreground truncate font-semibold hover:underline"
                href={`/users/${username}`}
              >
                {displayName}
              </Link>
            </UserTooltip>
            <UserBadge badge={author?.badge} badges={author?.badges} />
            <Link
              className="text-muted-foreground truncate hover:underline"
              href={`/users/${username}`}
            >
              @{username}
            </Link>
            <span className="text-muted-foreground shrink-0">·</span>
            <Link
              className="text-muted-foreground shrink-0 hover:underline"
              href={getPostPath({
                content: response.content,
                id: response.id,
                isGust: response.isGust,
              })}
              suppressHydrationWarning
            >
              {formatRelativeDate(response.createdAt)}
            </Link>
          </div>

          {/* The post this response replies to, embedded compactly (or a
              tombstone when it has been deleted). */}
          {response.parentPostId ? (
            <ResponseParentCard
              className="mt-1.5"
              parent={response.parentPost}
              parentPostId={response.parentPostId}
            />
          ) : null}

          {post.moderated ? (
            <ModeratedNotice className="mt-2.5" kind="post" />
          ) : (
            <>
              {post.content?.trim() ? (
                <div className="mt-1.5">
                  <PostLinkedContent content={post.content} embeds={embeds} />
                </div>
              ) : null}

              {attachments.length > 0 ? (
                <div className="mt-2.5 max-w-full overflow-hidden">
                  <MediaPreviews
                    attachments={attachments}
                    forceMobile
                    interactive
                    post={post}
                  />
                </div>
              ) : null}

              {post.embeds ? <PostLinkEmbeds embeds={embeds} /> : null}

              {post.tags?.length || post.mentions?.length ? (
                <PostMeta
                  content={post.content}
                  mentions={
                    post.mentions?.map((m) => m.user as unknown as UserData) ??
                    []
                  }
                  tags={(post.tags ?? []) as TagWithCount[]}
                />
              ) : null}
            </>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-1">
            <AuraVoteButton
              authorName={displayName}
              initialState={{
                aura: post.aura ?? 0,
                userVote: post.vote?.[0]?.value ?? 0,
              }}
              postId={post.id}
            />
            <button
              aria-label="Respond to this post"
              className="pill-3d-hover text-muted-foreground inline-flex h-8 items-center gap-1 rounded-full border-0 px-2 text-xs font-medium active:translate-y-px"
              onClick={() => onRespond(response)}
              type="button"
            >
              <CornerDownRight className="size-3.5" />
              Respond
            </button>
            <Link
              className="pill-3d-hover text-muted-foreground inline-flex h-8 items-center px-2 text-xs font-medium"
              href={getPostPath({
                content: response.content,
                id: response.id,
                isGust: response.isGust,
              })}
            >
              View thread
            </Link>
          </div>
        </div>
      </div>

      {children.map((child, index) => (
        <ResponseItem
          isLast={index === children.length - 1}
          key={child.response.id}
          node={child}
          onRespond={onRespond}
        />
      ))}
    </div>
  );
}
