"use client";

import type { UserData } from "@asm/db";
import { mediaReshareLabel } from "@asm/media";
import { Button } from "@asm/ui/shadui/button";
import { Eye, MessageSquare } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useSession } from "@/app/(main)/session-provider";
import Comments from "@/components/comments/thread/comments";
import {
  CommunityAttribution,
  CommunityShareCard,
} from "@/components/communities/card/community-attribution";
import FollowButton from "@/components/layouts/user/follow-button";
import UserAvatar from "@/components/layouts/user/user-avatar";
import UserBadge from "@/components/layouts/user/user-badge";
import UserTooltip from "@/components/layouts/user/user-tooltip";
import AuraVoteButton from "@/components/posts/actions/aura-vote-button";
import BookmarkButton from "@/components/posts/actions/bookmark-button";
import PostMoreButton from "@/components/posts/actions/post-more-button";
import { RespondAction } from "@/components/posts/actions/respond-action";
import ExplicitContentGate from "@/components/posts/content/explicit-content-gate";
import ModeratedNotice from "@/components/posts/content/moderated-notice";
import PostLinkedContent from "@/components/posts/content/post-linked-content";
import ViewTracker from "@/components/posts/effects/view-counter";
import PostLinkEmbeds from "@/components/posts/embeds/link-embeds";
import { BlueskyIcon } from "@/components/protocols/bluesky-icon";
import { ExternalAuthorTooltip } from "@/components/protocols/external-author-tooltip";
import { ExternalDiscussion } from "@/components/protocols/external-discussion";
import {
  ExternalBookmarkButton,
  ExternalRespondButton,
  ExternalShareButton,
  ExternalVoteButton,
} from "@/components/protocols/external-post-controls";
import {
  ExternalResponseParent,
  ExternalResponseParentRow,
} from "@/components/protocols/external-response-parent";
import { ResponseParentRow } from "@/components/responses/response-parent-card";
import { PostMeta } from "@/components/tags/post-meta";
import { communityAccentStyle } from "@/lib/communities/accent";
import { isInteractiveTarget } from "@/lib/interactive-target";
import { parseStoredEmbeds } from "@/lib/link-embeds/shared";
import { isPopupOpen } from "@/lib/popup-tracker";
import {
  isBookmarkedByUser,
  normalizePostData,
} from "@/lib/posts/post-normalize";
import type { PresentedPost as PostData } from "@/lib/posts/presentation";
import { blueskyProfilePath } from "@/lib/protocols/paths";
import { getPostPath } from "@/lib/seo/seo";
import { cn, formatNumber, formatRelativeDate } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";
import { withViewTransition } from "@/lib/view-transition";
import { useComposerStore } from "@/store/composer-store";

import { FeedPostSurface } from "./feed-post-surface";
import { HNStoryCard } from "./hn-story-card";
// eslint-disable-next-line import/no-cycle -- post-card renders media-previews, whose viewer surfaces related posts via post-card
import { MediaPreviews } from "./media-previews";
import ShareButton from "./share-button";

export { isInteractiveTarget } from "@/lib/interactive-target";

type ExtendedPostData = PostData & {
  hnStoryShare?: {
    storyId: number;
    title: string;
    url?: string | null;
    by: string;
    time: number;
    score: number;
    descendants: number;
  } | null;
};

function PostAuthorTooltip({
  post,
  children,
}: {
  post: PostData;
  children: React.ReactNode;
}) {
  return post.external ? (
    <ExternalAuthorTooltip author={post.external.author}>
      {children}
    </ExternalAuthorTooltip>
  ) : (
    <UserTooltip user={post.user}>{children}</UserTooltip>
  );
}

interface PostCardProps {
  detail?: boolean;
  hasThreadChild?: boolean;
  hasThreadParent?: boolean;
  initialMediaIndex?: number;
  isJoined?: boolean;
  // Renders the media with the mobile layout even in a wide viewport, for
  // narrow embedded columns (media page sidebar).
  mobileLayout?: boolean;
  post: ExtendedPostData;
  // Inside a community's own feed the a/<slug> attribution is redundant, so it
  // is suppressed there; elsewhere (home, profile, bookmarks) it still names
  // the source community.
  showCommunity?: boolean;
  // Ranked feeds add a short "Trending in a/<slug>" reason line beside the
  // community attribution; chronological feeds leave it off.
  showCommunityReason?: boolean;
}

interface PostHeaderProps {
  authorAvatarUrl?: string | null;
  authorBadge?: string | null;
  authorBadges?: readonly string[] | null;
  authorCommunityRoles?: readonly { role: string }[] | null;
  authorDisplayName: string;
  authorProfileHref: string;
  authorUsername: string;
  currentUserId: string;
  detail: boolean;
  isThreadChild: boolean;
  post: ExtendedPostData;
}

const PostHeader: React.FC<PostHeaderProps> = ({
  authorAvatarUrl,
  authorBadge,
  authorBadges,
  authorCommunityRoles,
  authorDisplayName,
  authorProfileHref,
  authorUsername,
  currentUserId,
  detail,
  isThreadChild,
  post,
}) => {
  if (detail && !isThreadChild) {
    return (
      <div className="relative flex items-start gap-2 sm:gap-3">
        <PostAuthorTooltip post={post}>
          <Link
            className="shrink-0 self-start"
            href={authorProfileHref}
            prefetch={false}
          >
            <UserAvatar
              avatarUrl={authorAvatarUrl}
              className="h-9 w-9 sm:h-12 sm:w-12"
              priority
            />
          </Link>
        </PostAuthorTooltip>

        <div className="min-w-0 flex-1 pr-9 sm:pr-19">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <PostAuthorTooltip post={post}>
              <Link
                className="text-foreground truncate text-[13px]/4.5 font-semibold hover:underline sm:text-base/6"
                href={authorProfileHref}
                prefetch={false}
              >
                {authorDisplayName}
              </Link>
            </PostAuthorTooltip>
            {post.external ? (
              <BlueskyIcon />
            ) : (
              <UserBadge
                badge={authorBadge}
                badges={authorBadges}
                communityRoles={authorCommunityRoles}
                className="h-4 w-12 sm:h-5 sm:w-15"
              />
            )}
            <Link
              className="text-muted-foreground shrink-0 text-[11px]/4 hover:underline sm:text-base/6"
              href={getPostPath(post)}
              prefetch={false}
              suppressHydrationWarning
            >
              {formatRelativeDate(post.createdAt)}
            </Link>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2">
            <PostAuthorTooltip post={post}>
              <Link
                className="text-muted-foreground truncate text-xs/4 hover:underline sm:text-base/6"
                href={authorProfileHref}
                prefetch={false}
              >
                @{authorUsername}
              </Link>
            </PostAuthorTooltip>
            {post.external ||
            !post.user ||
            post.user.id === currentUserId ? null : (
              <FollowButton
                className="h-7 px-3 text-xs"
                initialState={{
                  followers: post.user.followers.length,
                  isFollowedByUser: post.user.followers.length > 0,
                }}
                userId={post.user.id}
              />
            )}
          </div>
        </div>

        <div className="absolute top-0 right-0 z-10 flex shrink-0 items-center gap-1 sm:gap-1.5">
          <PostMoreButton
            className="h-7 w-7 p-0 sm:h-7.5 sm:w-7.5"
            post={post}
          />
          {post.external ? (
            <ExternalBookmarkButton
              post={post.external}
              className="hidden h-7 w-7 p-0 sm:inline-flex sm:h-7.5 sm:w-7.5"
            />
          ) : (
            <BookmarkButton
              className="hidden h-7 w-7 p-0 sm:inline-flex sm:h-7.5 sm:w-7.5"
              initialState={{
                isBookmarkedByUser: isBookmarkedByUser(post, currentUserId),
              }}
              postId={post.id}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-10 flex items-center justify-between gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs sm:gap-2 sm:text-sm">
        <PostAuthorTooltip post={post}>
          <Link
            className="text-foreground truncate font-semibold hover:underline"
            href={authorProfileHref}
            prefetch={false}
          >
            {authorDisplayName}
          </Link>
        </PostAuthorTooltip>
        {post.external ? (
          <BlueskyIcon />
        ) : (
          <UserBadge
            badge={authorBadge}
            badges={authorBadges}
            communityRoles={authorCommunityRoles}
          />
        )}
        <PostAuthorTooltip post={post}>
          <Link
            className="text-muted-foreground truncate hover:underline"
            href={authorProfileHref}
            prefetch={false}
          >
            @{authorUsername}
          </Link>
        </PostAuthorTooltip>
        <span className="text-muted-foreground shrink-0">·</span>
        <Link
          className="text-muted-foreground shrink-0 hover:underline"
          href={getPostPath(post)}
          prefetch={false}
          suppressHydrationWarning
        >
          {formatRelativeDate(post.createdAt)}
        </Link>
      </div>

      <div className="-my-1 flex shrink-0 items-center gap-1 sm:gap-1.5">
        <PostMoreButton className="h-7 w-7 p-0 sm:h-7.5 sm:w-7.5" post={post} />
        {post.external ? (
          <ExternalBookmarkButton
            post={post.external}
            className="hidden h-7 w-7 p-0 sm:inline-flex sm:h-7.5 sm:w-7.5"
          />
        ) : (
          <BookmarkButton
            className="hidden h-7 w-7 p-0 sm:inline-flex sm:h-7.5 sm:w-7.5"
            initialState={{
              isBookmarkedByUser: isBookmarkedByUser(post, currentUserId),
            }}
            postId={post.id}
          />
        )}
      </div>
    </div>
  );
};

interface ThreadConnectorRailProps {
  hasThreadChild: boolean;
  hasThreadParent: boolean;
  showParentRow: boolean;
}

// Thread connector rail: continuous unbroken line connecting parent to child avatar.
// Runs from card top/previous card boundary into the avatar center, and/or from the
// avatar center down to the card bottom/next card boundary.
const ThreadConnectorRail: React.FC<ThreadConnectorRailProps> = ({
  hasThreadChild,
  hasThreadParent,
  showParentRow,
}) => {
  const connectsToParent = hasThreadParent && !showParentRow;

  if (connectsToParent && hasThreadChild) {
    return (
      <span
        aria-hidden="true"
        className="bg-border pointer-events-none absolute -top-2.25 -bottom-2.25 left-1/2 w-0.5 -translate-x-1/2 sm:-top-2.75 sm:-bottom-2.75"
      />
    );
  }

  if (connectsToParent) {
    return (
      <span
        aria-hidden="true"
        className="bg-border pointer-events-none absolute -top-2.25 left-1/2 h-6.75 w-0.5 -translate-x-1/2 sm:-top-2.75 sm:h-7.75"
      />
    );
  }

  if (hasThreadChild) {
    return (
      <span
        aria-hidden="true"
        className="bg-border pointer-events-none absolute top-4.5 -bottom-2.25 left-1/2 w-0.5 -translate-x-1/2 sm:top-5 sm:-bottom-2.75"
      />
    );
  }

  return null;
};

interface PostContentProps {
  currentUserId: string;
  detail: boolean;
  hasThreadChild?: boolean;
  hasThreadParent?: boolean;
  initialMediaIndex?: number;
  isExpanded: boolean;
  isJoined: boolean;
  mobileLayout?: boolean;
  onToggleComments: () => void;
  onToggleExpand: () => void;
  post: ExtendedPostData;
  showCommunity?: boolean;
  showCommunityReason?: boolean;
}

const PostContent: React.FC<PostContentProps> = ({
  currentUserId,
  detail,
  hasThreadChild = false,
  hasThreadParent = false,
  initialMediaIndex,
  isExpanded,
  mobileLayout,
  onToggleComments,
  onToggleExpand,
  post,
  showCommunity = true,
  showCommunityReason = false,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const attachments = post.attachments ?? [];
  const contextCommunity = post.community;
  const [firstMedia] = attachments;
  // Validated stored embed payloads drive both the inline link badges and
  // the preview cards below the post.
  const postEmbeds = parseStoredEmbeds(post.embeds);
  // Attachment media and link embeds render as one gated block, so the gap
  // below the content follows the media rule (a roomier top gap only when the
  // post opens straight into attachment media) and an embed-only post keeps
  // the tighter spacing it always had.
  const mediaAndEmbedsTopMargin =
    attachments.length > 0 && !post.content?.trim() ? "mt-3.5" : "mt-2.5";

  useEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }
    const measure = () => {
      // Keep Show less visible while expanded; measure actual clipping when collapsed.
      if (!isExpanded) {
        setIsOverflowing(element.scrollHeight > element.clientHeight + 1);
      }
    };
    // Expansion and content changes require a fresh measurement even at the same width.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) {
      observer.observe(element.firstElementChild);
    }
    return () => observer.disconnect();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [isExpanded, post.content]);

  const authorUsername = post.user?.username || "unknown";
  const authorDisplayName = post.user?.displayName || authorUsername;
  const authorAvatarUrl = post.user?.avatarUrl;
  const authorBadge = post.user?.badge;
  const authorBadges = post.user?.badges;
  const authorCommunityRoles = post.user?.communityMemberships;
  const authorProfileHref =
    (post.external ? blueskyProfilePath(post.external.author.id) : undefined) ??
    (post.user?.username ? `/users/${post.user.username}` : "#");

  // A response shown in a feed or detail view: render the post it
  // replies to as the top node of a mini-thread, connected by a rail,
  // unless this post is already preceded by its parent in an ongoing thread.
  const showParentRow =
    Boolean(post.parentPostId || post.externalParent || post.external?.quote) &&
    !hasThreadParent;
  const isThreadChild = hasThreadParent || showParentRow;

  // Attachment media and link embeds render as one column, so a post with both
  // stacks them with the same gap and an embed-only post (a YouTube facade, an
  // OG card) is the sole child. The whole column is what the explicit gate
  // wraps below.
  const mediaAndEmbeds = (
    <div className="flex flex-col gap-2.5">
      {attachments.length > 0 ? (
        <MediaPreviews
          attachments={attachments}
          autoPlayVideos={detail}
          detail={detail}
          forceMobile={mobileLayout}
          initialMediaIndex={initialMediaIndex}
          post={post}
        />
      ) : null}
      {[
        ...new Set(
          attachments
            .map(mediaReshareLabel)
            .filter((label): label is string => Boolean(label))
        ),
      ].map((label) => (
        <span
          key={label}
          className="chip-3d text-muted-foreground w-fit px-2 py-1 text-xs"
        >
          {label}
        </span>
      ))}
      {postEmbeds.length > 0 ? (
        // Spacing comes from the column gap, not the embeds' own top margin.
        <PostLinkEmbeds className="" embeds={postEmbeds} />
      ) : null}
    </div>
  );

  return (
    <div>
      {showParentRow && post.external?.quote ? (
        <ExternalResponseParentRow
          post={post.external.quote}
          uri={post.external.quote.id}
        />
      ) : null}
      {showParentRow && !post.external?.quote && post.externalParent ? (
        <ExternalResponseParent uri={post.externalParent.uri} />
      ) : null}
      {showParentRow && !post.external?.quote && !post.externalParent ? (
        <ResponseParentRow
          parent={post.parentPost}
          parentPostId={post.parentPostId as string}
        />
      ) : null}
      {/* Native community post: the community is the card's top-left context,
          set above the avatar so the space it belongs to reads first, before
          the author. Suppressed inside that community's own feed, where the
          attribution is redundant; ranked feeds add the reason line. */}
      {post.recommendationSources?.length ? (
        <div className="text-muted-foreground mb-2 flex flex-wrap items-center gap-1 text-xs">
          <span>
            {post.recommendationSources.some(
              (person) => person.action === "like"
            )
              ? "Liked by people you follow ·"
              : "Amplified by"}
          </span>
          {post.recommendationSources.map((person, index) => (
            <span key={person.id}>
              {index ? ", " : ""}
              <Link
                className="hover:text-foreground hover:underline"
                href={
                  person.id.startsWith("did:")
                    ? `/network/bluesky/profile?${new URLSearchParams({ actor: person.id })}`
                    : `/users/${person.username}`
                }
              >
                {person.displayName || person.username}
              </Link>
            </span>
          ))}
          <span>· Following</span>
        </div>
      ) : null}
      {contextCommunity && showCommunity ? (
        <CommunityAttribution
          className="mb-2.5"
          community={{
            accentColor: contextCommunity.accentColor ?? "ember",
            id: contextCommunity.id ?? contextCommunity.slug,
            name: contextCommunity.name ?? contextCommunity.slug,
            slug: contextCommunity.slug,
          }}
          reason={
            post.community && showCommunityReason
              ? `Trending in a/${post.community.slug}`
              : undefined
          }
        />
      ) : null}
      <div className="flex items-start gap-3">
        {(!detail || isThreadChild) && (
          <div className="relative flex w-9 shrink-0 flex-col items-center self-stretch sm:w-10">
            <ThreadConnectorRail
              hasThreadChild={hasThreadChild}
              hasThreadParent={hasThreadParent}
              showParentRow={showParentRow}
            />
            <PostAuthorTooltip post={post}>
              <Link
                className="relative z-10 shrink-0 self-start"
                href={authorProfileHref}
              >
                <UserAvatar
                  avatarUrl={authorAvatarUrl}
                  className="h-9 w-9 sm:h-10 sm:w-10"
                  priority
                />
              </Link>
            </PostAuthorTooltip>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <PostHeader
            authorAvatarUrl={authorAvatarUrl}
            authorBadge={authorBadge}
            authorBadges={authorBadges}
            authorCommunityRoles={authorCommunityRoles}
            authorDisplayName={authorDisplayName}
            authorProfileHref={authorProfileHref}
            authorUsername={authorUsername}
            currentUserId={currentUserId}
            detail={detail}
            isThreadChild={isThreadChild}
            post={post}
          />

          {post.moderated ? (
            <ModeratedNotice className="mt-2.5" kind="post" />
          ) : (
            <>
              <div
                className={cn(
                  !isExpanded && "line-clamp-6",
                  detail && !isThreadChild ? "mt-3 sm:mt-3.5" : "mt-1"
                )}
                ref={contentRef}
              >
                {/* URLs inside the content render as inline badges (platform
                  logo + resolved embed title) instead of raw URLs. */}
                <PostLinkedContent
                  sourceSegments={post.external?.segments}
                  className={
                    detail && !isThreadChild
                      ? "text-sm/5.5 sm:text-[15px]/relaxed"
                      : undefined
                  }
                  content={post.content}
                  embeds={postEmbeds}
                />
              </div>
              {isOverflowing ? (
                <button
                  className="text-primary mt-1 cursor-pointer text-sm font-medium hover:underline"
                  aria-expanded={isExpanded}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleExpand();
                  }}
                  type="button"
                >
                  {isExpanded ? "Show less" : "Show more"}
                </button>
              ) : null}

              {post.hnStoryShare ? (
                <div className="hn-story-solid mt-3 overflow-hidden">
                  <HNStoryCard hnStory={post.hnStoryShare} />
                </div>
              ) : null}

              {/* Reshare of a community post onto the global feed: attribute
                  the source post and community. */}
              {post.communityShare ? (
                <CommunityShareCard
                  community={{
                    accentColor: post.community?.accentColor ?? "",
                    id:
                      post.community?.id ?? post.communityShare.community.slug,
                    name:
                      post.community?.name ??
                      post.communityShare.community.slug,
                    slug: post.communityShare.community.slug,
                  }}
                  sourcePostId={post.communityShare.sourcePostId}
                />
              ) : null}

              {/* Attachment media and link embeds share ONE explicit gate. A
                  post whose only "media" is a link preview (a YouTube facade,
                  an OG card) must blur behind the same Continue as a native
                  attachment; gating only MediaPreviews left embed-only posts
                  showing their player in the clear. Grouping both also gives a
                  post with media AND embeds a single overlay instead of two
                  stacked panels. */}
              {attachments.length > 0 || postEmbeds.length > 0 ? (
                <div
                  className={cn(
                    "max-w-full overflow-hidden",
                    mediaAndEmbedsTopMargin
                  )}
                >
                  {post.explicitContent ? (
                    <ExplicitContentGate revealKey={post.id}>
                      {mediaAndEmbeds}
                    </ExplicitContentGate>
                  ) : (
                    mediaAndEmbeds
                  )}
                </div>
              ) : null}

              {post.external?.unavailableQuote ? (
                <p className="text-muted-foreground mt-3 text-sm">
                  Quoted post unavailable
                </p>
              ) : null}
              {post.tags?.length || post.mentions?.length ? (
                <PostMeta
                  content={post.content}
                  mentions={
                    post.mentions?.map(
                      (m) => (m as unknown as { user: UserData }).user
                    ) ?? []
                  }
                  tags={post.tags ?? []}
                />
              ) : null}
            </>
          )}

          {/* Mobile bottom action bar: full-width justified with equal spacing across all buttons (Twitter style) */}
          <div className="mt-3 flex w-full items-center justify-between sm:hidden">
            {post.external ? (
              <ExternalVoteButton post={post.external} />
            ) : (
              <AuraVoteButton
                authorName={post.user?.displayName || post.user?.username}
                initialState={{
                  aura: post.aura ?? 0,
                  userVote: post.vote?.[0]?.value ?? 0,
                }}
                postId={post.id}
              />
            )}
            <CommentButton onClick={onToggleComments} post={post} />
            {post.external ? (
              <ExternalRespondButton post={post.external} />
            ) : (
              <RespondButton post={post} />
            )}
            {post.external ? null : (
              <span
                className="text-muted-foreground flex h-7 cursor-default items-center gap-1 rounded-full px-1"
                title="Views"
              >
                <Eye className="size-4" />
                <span className="text-xs tabular-nums">
                  {formatNumber(post.viewCount ?? 0)}
                </span>
              </span>
            )}
            <div className="flex items-center gap-1">
              {post.external ? (
                <ExternalShareButton post={post.external} />
              ) : (
                <ShareButton
                  defaultTab="link"
                  description={post.moderated ? "" : post.content}
                  dialogDescription="Share this post with your network"
                  dialogTitle="Share Post"
                  postId={post.id}
                  thumbnail={
                    post.moderated || !firstMedia
                      ? `/posts/${post.id}/opengraph-image`
                      : getMediaProxyUrl(firstMedia)
                  }
                  title={
                    post.moderated
                      ? `Post on asocialmedia`
                      : `${authorDisplayName} (@${authorUsername}) on asocialmedia`
                  }
                />
              )}
              {post.external ? (
                <ExternalBookmarkButton post={post.external} />
              ) : (
                <BookmarkButton
                  className="h-7 w-7 p-0"
                  initialState={{
                    isBookmarkedByUser: isBookmarkedByUser(post, currentUserId),
                  }}
                  postId={post.id}
                />
              )}
            </div>
          </div>

          {/* Desktop bottom action bar: classic layout with left and right groups, sized 1pt smaller */}
          <div className="mt-3 hidden sm:flex sm:items-center sm:justify-between sm:gap-2">
            <div className="flex items-center gap-1.5">
              {post.external ? (
                <ExternalVoteButton post={post.external} />
              ) : (
                <AuraVoteButton
                  authorName={post.user?.displayName || post.user?.username}
                  initialState={{
                    aura: post.aura ?? 0,
                    userVote: post.vote?.[0]?.value ?? 0,
                  }}
                  postId={post.id}
                />
              )}
              <CommentButton onClick={onToggleComments} post={post} />
              {post.external ? (
                <ExternalRespondButton post={post.external} />
              ) : (
                <RespondButton post={post} />
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {post.external ? null : (
                <span
                  className="text-muted-foreground flex h-7.5 cursor-default items-center gap-1.5 rounded-full px-2"
                  title="Views"
                >
                  <Eye className="size-4.5" />
                  <span className="text-[13px] tabular-nums">
                    {formatNumber(post.viewCount)}
                  </span>
                </span>
              )}
              {post.external ? (
                <ExternalShareButton post={post.external} />
              ) : (
                <ShareButton
                  defaultTab="link"
                  description={post.moderated ? "" : post.content}
                  dialogDescription="Share this post with your network"
                  dialogTitle="Share Post"
                  postId={post.id}
                  thumbnail={
                    post.moderated || !firstMedia
                      ? `/posts/${post.id}/opengraph-image`
                      : getMediaProxyUrl(firstMedia)
                  }
                  title={
                    post.moderated
                      ? `Post on asocialmedia`
                      : `${authorDisplayName} (@${authorUsername}) on asocialmedia`
                  }
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Feed eddies are capped at this height; anything beyond it is hidden behind
// a fade and a "Show more" link that opens the full post page.
const COMMENTS_MAX_HEIGHT = 480;

const FeedComments: React.FC<{ post: ExtendedPostData }> = ({ post }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isClamped, setIsClamped] = useState(false);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    // scrollHeight reports the full content height even while clipped, so the
    // clamp only turns on once the eddies genuinely outgrow the limit.
    setIsClamped(el.scrollHeight > COMMENTS_MAX_HEIGHT);
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    // Re-measure as eddies stream in or load via pagination.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  return (
    // Owns its clicks like the media previews do: tapping eddies here must
    // not bubble into the card-wide navigation to the post page.
    <div
      className="border-border/60 border-t px-4 pt-3.5 pb-4"
      data-card-interactive
    >
      <div
        className={cn(
          isClamped &&
            "overflow-hidden mask-[linear-gradient(to_bottom,black_85%,transparent)]"
        )}
        ref={containerRef}
        style={isClamped ? { maxHeight: COMMENTS_MAX_HEIGHT } : undefined}
      >
        {post.external ? (
          <ExternalDiscussion post={post.external} />
        ) : (
          <Comments post={post} />
        )}
      </div>
      {isClamped ? (
        <div className="mt-2.5 flex justify-center">
          <Button
            asChild
            className="h-8 rounded-full px-4 text-xs"
            variant="premium"
          >
            <Link href={getPostPath(post)}>Show more eddies</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
};

interface CommentButtonProps {
  onClick: () => void;
  post: PostData;
}

const CommentButton = ({ post, onClick }: CommentButtonProps) => {
  const commentCount = post._count?.comments ?? 0;
  const hasComments = commentCount > 0;
  return (
    <button
      className="pill-3d-hover group text-muted-foreground inline-flex h-7 items-center justify-center gap-1 rounded-full border-0 px-1.5 text-xs font-medium active:translate-y-px sm:h-7.5 sm:px-2 sm:text-[13px]"
      onClick={onClick}
      type="button"
    >
      <MessageSquare
        className={cn("size-4 sm:size-4.5", hasComments && "fill-current")}
      />
      <span className="text-xs font-medium tabular-nums sm:text-[13px]">
        {commentCount}
      </span>
    </button>
  );
};

interface RespondButtonProps {
  post: PostData;
}

// Opens the composer preloaded to respond to this post. Counts direct
// responses (threaded post-to-post replies), separate from eddies.
const RespondButton = ({ post }: RespondButtonProps) => {
  const openComposer = useComposerStore((state) => state.openComposer);
  return (
    <RespondAction
      count={post._count?.responses ?? 0}
      onClick={() =>
        openComposer("post", {
          attachments: post.attachments,
          avatarUrl: post.user?.avatarUrl ?? null,
          badge: post.user?.badge,
          badges: [...(post.user?.badges ?? [])],
          communityMemberships: post.user?.communityMemberships,
          content: post.content,
          createdAt: post.createdAt,
          displayName: post.user?.displayName ?? undefined,
          embeds: post.embeds,
          id: post.id,
          isGust: post.isGust,
          username: post.user?.username ?? "unknown",
        })
      }
    />
  );
};

// Hacker News signature accent: HN reshared posts receive an absolute orange
// left indicator line. Community posts reuse the exact rail geometry with the
// community's own accent, so both read as one system. Because the indicator is
// absolutely positioned (taking 0px in layout), every post card maintains
// standard padding (px-4) so avatars and the vertical thread connector rail
// stay 100% vertically aligned with responses.
export function getPostCardBorderAndPadding({
  hasHnStoryShare = false,
  hasThreadChild = false,
  hasThreadParent = false,
}: {
  hasHnStoryShare?: boolean;
  hasThreadChild?: boolean;
  hasThreadParent?: boolean;
}) {
  const hasHnIndicator = Boolean(hasHnStoryShare);

  const threadPaddingClass = cn(
    hasThreadParent ? "pt-2 sm:pt-2.5" : "pt-4",
    hasThreadChild ? "pb-2 sm:pb-2.5" : "pb-4",
    "px-4"
  );

  return {
    hasHnIndicator,
    threadPaddingClass,
  };
}

const PostCard: React.FC<PostCardProps> = ({
  detail = false,
  hasThreadChild = false,
  hasThreadParent = false,
  initialMediaIndex,
  isJoined = false,
  mobileLayout = false,
  post: initialPost,
  showCommunity = true,
  showCommunityReason = false,
}) => {
  const { user } = useSession();
  const router = useRouter();
  const normalizedInitial = normalizePostData(initialPost);
  const [post, setPost] = useState(normalizedInitial);
  const [showComments, setShowComments] = useState(detail);
  const [isExpanded, setIsExpanded] = useState(detail);

  // Keep the editable post state in sync with the latest props during
  // render instead of cascading through an effect.
  const [prevInitialPost, setPrevInitialPost] = useState(initialPost);
  if (prevInitialPost !== initialPost) {
    setPrevInitialPost(initialPost);
    setPost(normalizePostData(initialPost));
  }

  const handleToggleComments = useCallback(() => {
    setShowComments((prev) => !prev);
  }, []);

  const handleToggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const currentUserId = user?.id ?? "";

  const handleCardClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (detail) {
        return;
      }
      if (isInteractiveTarget(e.target)) {
        return;
      }
      // If any popup (dialog/menu) is open, a click on the overlay to dismiss it
      // should close the popup rather than navigate to the post.
      if (isPopupOpen()) {
        return;
      }
      withViewTransition(() => router.push(getPostPath(post)));
    },
    [detail, post, router]
  );

  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (detail || e.defaultPrevented) {
        return;
      }
      if (isInteractiveTarget(e.target)) {
        return;
      }
      // If any popup (dialog/menu) is open, key events should not navigate to the post.
      if (isPopupOpen()) {
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        withViewTransition(() => router.push(getPostPath(post)));
      }
    },
    [detail, post, router]
  );

  const body = (
    <PostContent
      currentUserId={currentUserId}
      detail={detail}
      hasThreadChild={hasThreadChild}
      hasThreadParent={hasThreadParent}
      initialMediaIndex={initialMediaIndex}
      isExpanded={isExpanded}
      isJoined={isJoined}
      mobileLayout={mobileLayout}
      onToggleComments={handleToggleComments}
      onToggleExpand={handleToggleExpand}
      post={post}
      showCommunity={showCommunity}
      showCommunityReason={showCommunityReason}
    />
  );

  let commentsSection: React.ReactNode = null;
  if (showComments) {
    // oxlint-disable-next-line unicorn/prefer-ternary -- The two layouts contain distinct JSX trees.
    if (detail) {
      commentsSection = (
        <div
          className="border-border/60 border-t px-4 pt-3.5 pb-4"
          data-card-interactive
        >
          {post.external ? (
            <ExternalDiscussion post={post.external} />
          ) : (
            <Comments post={post} />
          )}
        </div>
      );
    } else {
      commentsSection = <FeedComments post={post} />;
    }
  }

  const { hasHnIndicator, threadPaddingClass } = getPostCardBorderAndPadding({
    hasHnStoryShare: Boolean(post.hnStoryShare),
    hasThreadChild,
    hasThreadParent,
  });

  // The left rail: HN posts keep the orange signature, a community post takes
  // the community's accent. A community rail wins when a post is somehow both.
  let railStyle: React.CSSProperties | undefined;
  let railClassName =
    "pointer-events-none absolute inset-y-0 left-0 z-10 w-0.5";
  const railCommunity = post.community ?? post.communityShare?.community;
  if (railCommunity) {
    railStyle = communityAccentStyle(post.community?.accentColor ?? "ember");
    railClassName = cn(railClassName, "community-accent-rail");
  } else if (hasHnIndicator) {
    railClassName = cn(railClassName, "bg-orange-500");
  }
  const showRail = Boolean(railCommunity) || hasHnIndicator;

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- full card is clickable for post navigation while maintaining semantic article structure
    <motion.article
      animate={{ opacity: 1 }}
      className={cn(
        post.hnStoryShare ? "hn-story-share" : "",
        detail ? "cursor-default" : "cursor-pointer"
      )}
      data-post-id={post.id}
      id={`post-${post.id}`}
      initial={{ opacity: 0 }}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      tabIndex={detail ? -1 : 0}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {post.external ? null : <ViewTracker postId={post.id} />}
      {isJoined ? (
        <div className="group/post relative rounded-none bg-[hsl(var(--background-alt))]">
          {showRail ? (
            <span
              aria-hidden="true"
              className={railClassName}
              style={railStyle}
            />
          ) : null}
          <div
            className={cn(
              "transition-colors duration-150 hover:bg-[hsl(var(--muted))]",
              threadPaddingClass
            )}
          >
            {body}
          </div>
          {commentsSection}
        </div>
      ) : (
        <FeedPostSurface
          className={detail ? "border-x-0 border-b-0" : undefined}
          contentClassName={threadPaddingClass}
          footer={commentsSection}
          rail={
            showRail ? (
              <span
                aria-hidden="true"
                className={railClassName}
                style={railStyle}
              />
            ) : null
          }
        >
          {body}
        </FeedPostSurface>
      )}
    </motion.article>
  );
};

export default PostCard;
