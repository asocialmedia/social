"use client";

import type { PostData, TagWithCount, UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Card, CardContent } from "@asm/ui/shadui/card";
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
import Comments from "@/components/comments/comments";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import UserBadge from "@/components/layouts/user-badge";
import UserTooltip from "@/components/layouts/user-tooltip";
import AuraVoteButton from "@/components/posts/aura-vote-button";
import BookmarkButton from "@/components/posts/bookmark-button";
import ExplicitContentGate from "@/components/posts/explicit-content-gate";
import PostLinkEmbeds from "@/components/posts/link-embeds";
import ModeratedNotice from "@/components/posts/moderated-notice";
import PostLinkedContent from "@/components/posts/post-linked-content";
import PostMoreButton from "@/components/posts/post-more-button";
import ViewTracker from "@/components/posts/view-counter";
import { PostMeta } from "@/components/tags/post-meta";
import { parseStoredEmbeds } from "@/lib/link-embeds/shared";
import { isPopupOpen } from "@/lib/popup-tracker";
import { isBookmarkedByUser, normalizePostData } from "@/lib/post-normalize";
import { cn, formatNumber, formatRelativeDate } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";
import { withViewTransition } from "@/lib/view-transition";

import { HNStoryCard } from "./hn-story-card";
// eslint-disable-next-line import/no-cycle -- post-card renders media-previews, whose viewer surfaces related posts via post-card
import { MediaPreviews } from "./media-previews";
import ShareButton from "./share-button";

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

interface PostCardProps {
  detail?: boolean;
  // Hides the below-post composer on mobile for detail views that already
  // surface a floating mobile editor (post page).
  hideComposerOnMobile?: boolean;
  initialMediaIndex?: number;
  isJoined?: boolean;
  // Renders the media with the mobile layout even in a wide viewport, for
  // narrow embedded columns (media page sidebar).
  mobileLayout?: boolean;
  post: ExtendedPostData;
}

interface PostContentProps {
  currentUserId: string;
  detail: boolean;
  initialMediaIndex?: number;
  isExpanded: boolean;
  isJoined: boolean;
  mobileLayout?: boolean;
  onToggleComments: () => void;
  onToggleExpand: () => void;
  post: ExtendedPostData;
}

const PostContent: React.FC<PostContentProps> = ({
  currentUserId,
  detail,
  isExpanded,
  isJoined,
  mobileLayout,
  onToggleComments,
  onToggleExpand,
  post,
  initialMediaIndex,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const attachments = post.attachments ?? [];
  const [firstMedia] = attachments;
  // Validated stored embed payloads drive both the inline link badges and
  // the preview cards below the post.
  const postEmbeds = parseStoredEmbeds(post.embeds);

  const updateOverflow = useCallback(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    // 6 lines at ~24px line-height = 144px threshold
    setIsOverflowing(el.scrollHeight > 144);
  }, []);

  useEffect(() => {
    // Only check if content is long enough to potentially overflow
    if (post.content && post.content.length > 150) {
      updateOverflow();
    }
    // isExpanded is a trigger only: expanding must re-measure even though
    // the value itself is not read here.
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- re-measure on expand/collapse
  }, [isExpanded, post.content, updateOverflow]);

  const authorUsername = post.user?.username || "unknown";
  const authorDisplayName = post.user?.displayName || authorUsername;
  const authorAvatarUrl = post.user?.avatarUrl;
  const authorBadge = post.user?.badge;
  const authorBadges = post.user?.badges;
  const authorProfileHref = post.user?.username
    ? `/users/${post.user.username}`
    : "#";

  return (
    <div className="flex items-start gap-3">
      {!detail && (
        <UserTooltip user={post.user}>
          <Link className="shrink-0 self-start" href={authorProfileHref}>
            <UserAvatar
              avatarUrl={authorAvatarUrl}
              className="h-9 w-9 sm:h-10 sm:w-10"
              priority
            />
          </Link>
        </UserTooltip>
      )}

      <div className="min-w-0 flex-1">
        {detail ? (
          <div className="relative flex items-start gap-2 sm:gap-3">
            <UserTooltip user={post.user}>
              <Link
                className="shrink-0 self-start"
                href={authorProfileHref}
                prefetch={false}
              >
                <UserAvatar
                  avatarUrl={authorAvatarUrl}
                  className="h-10 w-10 sm:h-12 sm:w-12"
                  priority
                />
              </Link>
            </UserTooltip>

            <div className="min-w-0 flex-1 pr-[4.75rem]">
              <div className="flex min-w-0 items-center gap-2">
                <UserTooltip user={post.user}>
                  <Link
                    className="text-foreground truncate font-semibold hover:underline"
                    href={authorProfileHref}
                    prefetch={false}
                  >
                    {authorDisplayName}
                  </Link>
                </UserTooltip>
                <UserBadge badge={authorBadge} badges={authorBadges} />
                <Link
                  className="text-muted-foreground shrink-0 hover:underline"
                  href={`/posts/${post.id}`}
                  prefetch={false}
                  suppressHydrationWarning
                >
                  {formatRelativeDate(post.createdAt)}
                </Link>
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-2">
                <UserTooltip user={post.user}>
                  <Link
                    className="text-muted-foreground truncate hover:underline"
                    href={authorProfileHref}
                    prefetch={false}
                  >
                    @{authorUsername}
                  </Link>
                </UserTooltip>
                {!post.user || post.user.id === currentUserId ? null : (
                  <FollowButton
                    className="h-7 px-3 text-xs"
                    initialState={{
                      followers: post.user._count?.followers ?? 0,
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
              <BookmarkButton
                className="hidden h-7 w-7 p-0 sm:inline-flex sm:h-7.5 sm:w-7.5"
                initialState={{
                  isBookmarkedByUser: isBookmarkedByUser(post, currentUserId),
                }}
                postId={post.id}
              />
            </div>
          </div>
        ) : (
          <div className="relative z-10 flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs sm:gap-2 sm:text-sm">
              <UserTooltip user={post.user}>
                <Link
                  className="text-foreground truncate font-semibold hover:underline"
                  href={authorProfileHref}
                  prefetch={false}
                >
                  {authorDisplayName}
                </Link>
              </UserTooltip>
              <UserBadge badge={authorBadge} badges={authorBadges} />
              <UserTooltip user={post.user}>
                <Link
                  className="text-muted-foreground truncate hover:underline"
                  href={authorProfileHref}
                  prefetch={false}
                >
                  @{authorUsername}
                </Link>
              </UserTooltip>
              <span className="text-muted-foreground shrink-0">·</span>
              <Link
                className="text-muted-foreground shrink-0 hover:underline"
                href={`/posts/${post.id}`}
                prefetch={false}
                suppressHydrationWarning
              >
                {formatRelativeDate(post.createdAt)}
              </Link>
            </div>

            <div className="-my-1 flex shrink-0 items-center gap-1 sm:gap-1.5">
              <PostMoreButton
                className="h-7 w-7 p-0 sm:h-7.5 sm:w-7.5"
                post={post}
              />
              <BookmarkButton
                className="hidden h-7 w-7 p-0 sm:inline-flex sm:h-7.5 sm:w-7.5"
                initialState={{
                  isBookmarkedByUser: isBookmarkedByUser(post, currentUserId),
                }}
                postId={post.id}
              />
            </div>
          </div>
        )}

        {post.moderated ? (
          <ModeratedNotice className="mt-2.5" kind="post" />
        ) : (
          <>
            <div
              className={cn(!isExpanded && "line-clamp-6", detail && "mt-3.5")}
              ref={contentRef}
            >
              {/* URLs inside the content render as inline badges (platform
                  logo + resolved embed title) instead of raw URLs. */}
              <PostLinkedContent content={post.content} embeds={postEmbeds} />
            </div>
            {isOverflowing ? (
              <button
                className="text-primary mt-1 cursor-pointer text-sm font-medium hover:underline"
                onClick={onToggleExpand}
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

            {!!attachments.length && (
              <div
                className={cn(
                  "max-w-full overflow-hidden",
                  post.content?.trim() ? "mt-2.5" : "mt-3.5"
                )}
              >
                {post.explicitContent ? (
                  <ExplicitContentGate revealKey={post.id}>
                    <MediaPreviews
                      attachments={attachments}
                      autoPlayVideos={detail}
                      forceMobile={mobileLayout}
                      initialMediaIndex={initialMediaIndex}
                      interactive={!isJoined}
                      post={post}
                    />
                  </ExplicitContentGate>
                ) : (
                  <MediaPreviews
                    attachments={attachments}
                    autoPlayVideos={detail}
                    forceMobile={mobileLayout}
                    initialMediaIndex={initialMediaIndex}
                    interactive={!isJoined}
                    post={post}
                  />
                )}
              </div>
            )}

            {/* Link embeds live below the media block: previews resolved at
                publish time, rendered from the stored (validated) payloads. */}
            {post.embeds ? <PostLinkEmbeds embeds={postEmbeds} /> : null}

            {post.tags?.length || post.mentions?.length ? (
              <PostMeta
                mentions={
                  post.mentions?.map((m) => m.user as unknown as UserData) ?? []
                }
                tags={(post.tags ?? []) as TagWithCount[]}
              />
            ) : null}
          </>
        )}

        {/* Mobile bottom action bar: full-width justified with equal spacing across all buttons (Twitter style) */}
        <div className="mt-3 flex w-full items-center justify-between sm:hidden">
          <AuraVoteButton
            authorName={post.user?.displayName || post.user?.username}
            initialState={{
              aura: post.aura ?? 0,
              userVote: post.vote?.[0]?.value ?? 0,
            }}
            postId={post.id}
          />
          <CommentButton onClick={onToggleComments} post={post} />
          <span
            className="text-muted-foreground flex h-7 cursor-default items-center gap-1 rounded-full px-1"
            title="Views"
          >
            <Eye className="size-4" />
            <span className="text-xs tabular-nums">
              {formatNumber(post.viewCount ?? 0)}
            </span>
          </span>
          <div className="flex items-center gap-1">
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
            <BookmarkButton
              className="h-7 w-7 p-0"
              initialState={{
                isBookmarkedByUser: isBookmarkedByUser(post, currentUserId),
              }}
              postId={post.id}
            />
          </div>
        </div>

        {/* Desktop bottom action bar: classic layout with left and right groups, sized 1pt smaller */}
        <div className="mt-3 hidden sm:flex sm:items-center sm:justify-between sm:gap-2">
          <div className="flex items-center gap-1.5">
            <AuraVoteButton
              authorName={post.user?.displayName || post.user?.username}
              initialState={{
                aura: post.aura ?? 0,
                userVote: post.vote?.[0]?.value ?? 0,
              }}
              postId={post.id}
            />
            <CommentButton onClick={onToggleComments} post={post} />
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className="text-muted-foreground flex h-7.5 cursor-default items-center gap-1.5 rounded-full px-2"
              title="Views"
            >
              <Eye className="size-4.5" />
              <span className="text-[13px] tabular-nums">
                {formatNumber(post.viewCount)}
              </span>
            </span>
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
        <Comments post={post} />
      </div>
      {isClamped ? (
        <div className="mt-2.5 flex justify-center">
          <Button
            asChild
            className="h-8 rounded-full px-4 text-xs"
            variant="premium"
          >
            <Link href={`/posts/${post.id}`}>Show more eddies</Link>
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

const INTERACTIVE_TARGET_SELECTOR =
  "a, button, input, textarea, select, option, video, audio, [role='button'], [role='checkbox'], [role='menuitem'], [role='option'], [role='tab'], [role='combobox'], [data-card-interactive], [contenteditable='true']";

export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }
  const el = target as Element;
  if (typeof el.closest !== "function") {
    return false;
  }
  const isContentEditable =
    "isContentEditable" in target &&
    Boolean((target as HTMLElement).isContentEditable);
  return Boolean(el.closest(INTERACTIVE_TARGET_SELECTOR) || isContentEditable);
}

const PostCard: React.FC<PostCardProps> = ({
  post: initialPost,
  isJoined = false,
  detail = false,
  hideComposerOnMobile = false,
  initialMediaIndex,
  mobileLayout = false,
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
      withViewTransition(() => router.push(`/posts/${post.id}`));
    },
    [detail, post.id, router]
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
        withViewTransition(() => router.push(`/posts/${post.id}`));
      }
    },
    [detail, post.id, router]
  );

  const body = (
    <PostContent
      currentUserId={currentUserId}
      detail={detail}
      initialMediaIndex={initialMediaIndex}
      isExpanded={isExpanded}
      isJoined={isJoined}
      mobileLayout={mobileLayout}
      onToggleComments={handleToggleComments}
      onToggleExpand={handleToggleExpand}
      post={post}
    />
  );

  let commentsSection: React.ReactNode = null;
  if (showComments) {
    commentsSection = detail ? (
      <div className="border-border/60 border-t px-4 pt-3.5 pb-4">
        <Comments hideComposerOnMobile={hideComposerOnMobile} post={post} />
      </div>
    ) : (
      <FeedComments post={post} />
    );
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- full card is clickable for post navigation while maintaining semantic article structure
    <motion.article
      animate={{ opacity: 1 }}
      className={cn(
        post.hnStoryShare ? "hn-story-share" : "",
        detail ? "cursor-default" : "cursor-pointer"
      )}
      id={`post-${post.id}`}
      initial={{ opacity: 0 }}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      tabIndex={detail ? -1 : 0}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <ViewTracker postId={post.id} />
      {isJoined ? (
        <div
          className={`group/post rounded-none bg-[hsl(var(--background-alt))] ${post.hnStoryShare ? "border-l-2 border-l-orange-500" : ""}`}
        >
          <div
            className={`p-4 transition-colors duration-150 hover:bg-[hsl(var(--muted))] ${post.hnStoryShare ? "pl-5" : ""}`}
          >
            {body}
          </div>
          {commentsSection}
        </div>
      ) : (
        <Card
          className={`group/post rounded-none bg-[hsl(var(--background-alt))] shadow-none ${detail ? "border-x-0 border-b-0" : ""} ${post.hnStoryShare ? "border-l-2 border-l-orange-500" : ""}`}
        >
          <CardContent className="p-4 transition-colors duration-150 hover:bg-[hsl(var(--muted))]">
            {body}
          </CardContent>
          {commentsSection}
        </Card>
      )}
    </motion.article>
  );
};

export default PostCard;
