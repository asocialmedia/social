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
import { canModeratePost } from "@/lib/moderation";
import { isPopupOpen } from "@/lib/popup-tracker";
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
  canModerate: boolean;
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
  canModerate,
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

  return (
    <div className="flex items-start gap-3">
      {!detail && (
        <UserTooltip user={post.user}>
          <Link
            className="shrink-0 self-start"
            href={`/users/${post.user.username}`}
          >
            <UserAvatar
              avatarUrl={post.user.avatarUrl}
              className="h-10 w-10"
              priority
            />
          </Link>
        </UserTooltip>
      )}

      <div className="min-w-0 flex-1">
        <div className="relative flex items-start gap-2">
          {detail ? (
            <UserTooltip user={post.user}>
              <Link
                className="shrink-0 self-start"
                href={`/users/${post.user.username}`}
                prefetch={false}
              >
                <UserAvatar
                  avatarUrl={post.user.avatarUrl}
                  className="h-12 w-12"
                  priority
                />
              </Link>
            </UserTooltip>
          ) : null}

          {detail ? (
            <div className="min-w-0 flex-1 pr-16">
              <div className="flex min-w-0 items-center gap-2">
                <UserTooltip user={post.user}>
                  <Link
                    className="text-foreground truncate font-semibold hover:underline"
                    href={`/users/${post.user.username}`}
                    prefetch={false}
                  >
                    {post.user.displayName}
                  </Link>
                </UserTooltip>
                <UserBadge badge={post.user.badge} badges={post.user.badges} />
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
                    href={`/users/${post.user.username}`}
                    prefetch={false}
                  >
                    @{post.user.username}
                  </Link>
                </UserTooltip>
                {post.user.id === currentUserId ? null : (
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
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2 pr-16 text-sm">
              <UserTooltip user={post.user}>
                <Link
                  className="text-foreground truncate font-semibold hover:underline"
                  href={`/users/${post.user.username}`}
                  prefetch={false}
                >
                  {post.user.displayName}
                </Link>
              </UserTooltip>
              <UserBadge badge={post.user.badge} badges={post.user.badges} />
              <UserTooltip user={post.user}>
                <Link
                  className="text-muted-foreground truncate hover:underline"
                  href={`/users/${post.user.username}`}
                  prefetch={false}
                >
                  @{post.user.username}
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
          )}

          <div className="absolute top-0 right-0 flex items-center gap-1.5">
            {canModerate && (
              <PostMoreButton
                // Touch devices have no hover, so the button must always be
                // visible there; on desktop it still fades in on card hover.
                className="transition-opacity sm:opacity-0 sm:group-hover/post:opacity-100"
                post={post}
              />
            )}
            <BookmarkButton
              className="h-8 w-8 p-0"
              initialState={{
                isBookmarkedByUser: post.bookmarks.some(
                  (bookmark) => bookmark.userId === currentUserId
                ),
              }}
              postId={post.id}
            />
          </div>
        </div>

        {post.moderated ? (
          <ModeratedNotice className="mt-2.5" kind="post" />
        ) : (
          <>
            <div className={cn(!isExpanded && "line-clamp-6")} ref={contentRef}>
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

            {!!post.attachments.length && (
              <div
                className={cn(
                  "max-w-full overflow-hidden",
                  post.content?.trim() ? "mt-2.5" : "mt-3.5"
                )}
              >
                {post.explicitContent ? (
                  <ExplicitContentGate revealKey={post.id}>
                    <MediaPreviews
                      attachments={post.attachments}
                      autoPlayVideos={detail}
                      forceMobile={mobileLayout}
                      initialMediaIndex={initialMediaIndex}
                      interactive={!isJoined}
                      post={post}
                    />
                  </ExplicitContentGate>
                ) : (
                  <MediaPreviews
                    attachments={post.attachments}
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
                mentions={post.mentions.map(
                  (m) => m.user as unknown as UserData
                )}
                tags={post.tags as TagWithCount[]}
              />
            ) : null}
          </>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <AuraVoteButton
              authorName={post.user.displayName}
              initialState={{
                aura: post.aura,
                userVote: post.vote[0]?.value || 0,
              }}
              postId={post.id}
            />
            <CommentButton onClick={onToggleComments} post={post} />
          </div>

          <div className="flex items-center gap-1">
            <span
              className="text-muted-foreground flex h-8 cursor-default items-center gap-1.5 rounded-full px-2"
              title="Views"
            >
              <Eye className="size-5" />
              <span className="text-sm tabular-nums">
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
                post.moderated || !post.attachments[0]
                  ? `/posts/${post.id}/opengraph-image`
                  : getMediaProxyUrl(post.attachments[0])
              }
              title={
                post.moderated
                  ? `Post on asocialmedia`
                  : `${post.user.displayName || post.user.username} (@${post.user.username}) on asocialmedia`
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
      className="border-border/60 border-t px-4 pt-2 pb-4"
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
  const hasComments = post._count.comments > 0;
  return (
    <button
      className="pill-3d-hover group text-muted-foreground inline-flex h-8 items-center justify-center gap-1 rounded-full border-0 px-2 text-sm font-medium active:translate-y-px"
      onClick={onClick}
      type="button"
    >
      <MessageSquare className={cn("size-5", hasComments && "fill-current")} />
      <span className="text-sm font-medium tabular-nums">
        {post._count.comments}
      </span>
    </button>
  );
};

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
  const [post, setPost] = useState(initialPost);
  const [showComments, setShowComments] = useState(detail);
  const [isExpanded, setIsExpanded] = useState(detail);

  // Keep the editable post state in sync with the latest props during
  // render instead of cascading through an effect.
  const [prevInitialPost, setPrevInitialPost] = useState(initialPost);
  if (prevInitialPost !== initialPost) {
    setPrevInitialPost(initialPost);
    setPost(initialPost);
  }

  const handleToggleComments = useCallback(() => {
    setShowComments((prev) => !prev);
  }, []);

  const handleToggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const currentUserId = user?.id ?? "";
  const canModerate = canModeratePost(user, post);

  const handleCardClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (detail) {
        return;
      }
      const target = e.target as HTMLElement;
      if (
        target.closest(
          "a, button, input, textarea, video, [role='button'], [data-card-interactive]"
        )
      ) {
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
      if (detail) {
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
      canModerate={canModerate}
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
      <div className="border-border/60 border-t px-4 pt-2 pb-4">
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
