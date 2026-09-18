"use client";

import type { PostData, TagWithCount, UserData } from "@asm/db";
import { CornerDownRight, ImageOff } from "lucide-react";
import Link from "next/link";

// eslint-disable-next-line import/no-cycle -- response rows render media-previews, whose viewer surfaces related posts via post-card, which renders responses
import { MediaPreviews } from "@/components/home/feedview/media-previews";
import UserAvatar from "@/components/layouts/user/user-avatar";
import UserBadge from "@/components/layouts/user/user-badge";
import UserTooltip from "@/components/layouts/user/user-tooltip";
import AuraVoteButton from "@/components/posts/actions/aura-vote-button";
import ExplicitContentGate from "@/components/posts/content/explicit-content-gate";
import ModeratedNotice from "@/components/posts/content/moderated-notice";
import PostLinkedContent from "@/components/posts/content/post-linked-content";
import PostLinkEmbeds from "@/components/posts/embeds/link-embeds";
import { PostMeta } from "@/components/tags/post-meta";
import { parseStoredEmbeds } from "@/lib/link-embeds/shared";
import { normalizePostData } from "@/lib/posts/post-normalize";
import { getPostPath } from "@/lib/seo/seo";
import { formatRelativeDate } from "@/lib/utils";

import type { ResponseNode } from "./response-tree";

// Twitter-style thread geometry: every reply is one column with a single
// straight vertical line dropping from the centre of each avatar to the next.
// No curves and no per-level indent, so nested replies can never produce a
// stray second spine or a compounding offset.
const AVATAR_SIZE = 40;
const LINE_WIDTH = 2;
// In ResponseItem with px-4 (16px) horizontal padding:
// Avatar center is at 16 + AVATAR_SIZE / 2 = 36px.
// 2px line centered under the avatar has left = 36 - 1 = 35px.
const LINE_LEFT = 16 + AVATAR_SIZE / 2 - LINE_WIDTH / 2;
// Avatar top is at 10px (py-2.5); avatar center Y is 10 + AVATAR_SIZE / 2 = 30px.
const LINE_CENTER_Y = 10 + AVATAR_SIZE / 2;

interface ResponseConnectorRailProps {
  hasConnectingChild: boolean;
  hasConnectingParent: boolean;
}

function ResponseConnectorRail({
  hasConnectingChild,
  hasConnectingParent,
}: ResponseConnectorRailProps) {
  if (hasConnectingParent && hasConnectingChild) {
    return (
      <span
        aria-hidden="true"
        className="bg-border pointer-events-none absolute"
        style={{
          bottom: 0,
          left: LINE_LEFT,
          top: -1,
          width: LINE_WIDTH,
        }}
      />
    );
  }

  if (hasConnectingParent) {
    return (
      <span
        aria-hidden="true"
        className="bg-border pointer-events-none absolute"
        style={{
          height: LINE_CENTER_Y + 1,
          left: LINE_LEFT,
          top: -1,
          width: LINE_WIDTH,
        }}
      />
    );
  }

  if (hasConnectingChild) {
    return (
      <span
        aria-hidden="true"
        className="bg-border pointer-events-none absolute"
        style={{
          bottom: 0,
          left: LINE_LEFT,
          top: LINE_CENTER_Y,
          width: LINE_WIDTH,
        }}
      />
    );
  }

  return null;
}

interface ResponseItemProps {
  // True when this response has a child response connected directly below it
  hasConnectingChild?: boolean;
  // True when this response has a parent response connected directly above it
  hasConnectingParent?: boolean;
  node: ResponseNode;
  onRespond: (response: PostData) => void;
}

export default function ResponseItem({
  hasConnectingChild = false,
  hasConnectingParent = false,
  node,
  onRespond,
}: ResponseItemProps) {
  const { response } = node;
  const author = response.user;
  const username = author?.username ?? "unknown";
  const displayName = author?.displayName || username;
  const embeds = parseStoredEmbeds(response.embeds);
  const attachments = response.attachments ?? [];
  // normalizePostData heals viewer-scoped joins that can be lost in transit; it
  // is a no-op on a well-formed row.
  const post = normalizePostData(response) as PostData;

  // Attachments and link embeds render as one column, then the whole column is
  // wrapped by the explicit gate below when the reply is flagged.
  const mediaAndEmbeds = (
    <div className="flex flex-col gap-2.5">
      {attachments.length > 0 ? (
        <MediaPreviews
          attachments={attachments}
          forceMobile
          interactive
          post={post}
        />
      ) : null}
      {embeds.length > 0 ? (
        <PostLinkEmbeds className="" embeds={embeds} />
      ) : null}
    </div>
  );

  return (
    <div
      className="relative scroll-mt-4 px-4 py-2.5"
      id={`response-${response.id}`}
    >
      <ResponseConnectorRail
        hasConnectingChild={hasConnectingChild}
        hasConnectingParent={hasConnectingParent}
      />

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
            <UserBadge
              badge={author?.badge}
              badges={author?.badges}
              communityRoles={author?.communityMemberships}
            />
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
                community: response.community,
                content: response.content,
                id: response.id,
                isGust: response.isGust,
              })}
              suppressHydrationWarning
            >
              {formatRelativeDate(response.createdAt)}
            </Link>
          </div>

          {/* A tombstone parent notice when the parent was deleted */}
          {response.parentPostId && !response.parentPost ? (
            <div className="border-border/60 bg-muted/40 text-muted-foreground mt-1.5 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs">
              <ImageOff className="size-3.5 shrink-0" />
              <span>This post is unavailable</span>
            </div>
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

              {/* Media and embeds share one explicit gate, matching the feed
                  card: an explicit reply must blur behind the same Continue,
                  whether it carries native attachments or only a link preview. */}
              {attachments.length > 0 || embeds.length > 0 ? (
                <div className="mt-2.5 max-w-full overflow-hidden">
                  {post.explicitContent ? (
                    <ExplicitContentGate revealKey={post.id}>
                      {mediaAndEmbeds}
                    </ExplicitContentGate>
                  ) : (
                    mediaAndEmbeds
                  )}
                </div>
              ) : null}

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
                community: response.community,
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
    </div>
  );
}
