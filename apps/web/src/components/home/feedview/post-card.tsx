// biome-ignore-all lint/a11y/noNoninteractiveElementInteractions: The post card is a clickable region; nested interactive elements are excluded via the click guard.
// biome-ignore-all lint/a11y/noStaticElementInteractions: The post card region navigates to the post page on click.
// biome-ignore-all lint/a11y/useKeyWithClickEvents: Keyboard navigation is handled via the inner links and buttons; Enter/Space also trigger navigation.
"use client";

import type { PostData, TagWithCount, UserData } from "@asm/db";
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
import UserTooltip from "@/components/layouts/user-tooltip";
import AuraVoteButton from "@/components/posts/aura-vote-button";
import BookmarkButton from "@/components/posts/bookmark-button";
import PostMoreButton from "@/components/posts/post-more-button";
import ViewTracker from "@/components/posts/view-counter";
import { PostMeta } from "@/components/tags/post-meta";
import Linkify from "@/helpers/global/linkify";
import { isPopupOpen } from "@/lib/popup-tracker";
import { cn, formatRelativeDate } from "@/lib/utils";
import { HNStoryCard } from "./hn-story-card";
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
  initialMediaIndex?: number;
  isJoined?: boolean;
  post: ExtendedPostData;
}

interface PostContentProps {
  currentUserId: string;
  detail: boolean;
  initialMediaIndex?: number;
  isExpanded: boolean;
  isJoined: boolean;
  onToggleComments: () => void;
  onToggleExpand: () => void;
  post: ExtendedPostData;
}

const PostContent: React.FC<PostContentProps> = ({
  currentUserId,
  detail,
  isExpanded,
  isJoined,
  onToggleComments,
  onToggleExpand,
  post,
  initialMediaIndex,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const updateOverflow = useCallback(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    // Content collapses to 6 lines (line-clamp-6). Compare the full content
    // height against 6 rendered lines so short posts never get a toggle, even
    // when the post is shown fully expanded (detail view).
    const paragraph = el.querySelector("p");
    const computedLineHeight = paragraph
      ? Number.parseFloat(getComputedStyle(paragraph).lineHeight)
      : 0;
    const lineHeight =
      Number.isFinite(computedLineHeight) && computedLineHeight > 0
        ? computedLineHeight
        : 24;
    setIsOverflowing(el.scrollHeight > lineHeight * 6);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: isExpanded must retrigger the overflow re-measure after collapse
  useLayoutEffect(() => {
    updateOverflow();
  }, [isExpanded, updateOverflow]);

  useEffect(() => {
    const frame = requestAnimationFrame(updateOverflow);
    return () => cancelAnimationFrame(frame);
  }, [updateOverflow]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateOverflow]);

  return (
    <div className="flex gap-3">
      {!detail && (
        <UserTooltip user={post.user}>
          <Link className="shrink-0" href={`/users/${post.user.username}`}>
            <UserAvatar avatarUrl={post.user.avatarUrl} className="h-10 w-10" />
          </Link>
        </UserTooltip>
      )}

      <div className="min-w-0 flex-1">
        <div className="relative flex items-start gap-2">
          {detail ? (
            <UserTooltip user={post.user}>
              <Link className="shrink-0" href={`/users/${post.user.username}`}>
                <UserAvatar
                  avatarUrl={post.user.avatarUrl}
                  className="h-12 w-12"
                />
              </Link>
            </UserTooltip>
          ) : null}

          {detail ? (
            <div className="min-w-0 flex-1 pr-16">
              <div className="flex min-w-0 items-center gap-2">
                <UserTooltip user={post.user}>
                  <Link
                    className="truncate font-semibold text-foreground hover:underline"
                    href={`/users/${post.user.username}`}
                  >
                    {post.user.displayName}
                  </Link>
                </UserTooltip>
                <Link
                  className="shrink-0 text-muted-foreground hover:underline"
                  href={`/posts/${post.id}`}
                  suppressHydrationWarning
                >
                  {formatRelativeDate(post.createdAt)}
                </Link>
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-2">
                <UserTooltip user={post.user}>
                  <Link
                    className="truncate text-muted-foreground hover:underline"
                    href={`/users/${post.user.username}`}
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
                  className="truncate font-semibold text-foreground hover:underline"
                  href={`/users/${post.user.username}`}
                >
                  {post.user.displayName}
                </Link>
              </UserTooltip>
              <UserTooltip user={post.user}>
                <Link
                  className="truncate text-muted-foreground hover:underline"
                  href={`/users/${post.user.username}`}
                >
                  @{post.user.username}
                </Link>
              </UserTooltip>
              <span className="shrink-0 text-muted-foreground">·</span>
              <Link
                className="shrink-0 text-muted-foreground hover:underline"
                href={`/posts/${post.id}`}
                suppressHydrationWarning
              >
                {formatRelativeDate(post.createdAt)}
              </Link>
            </div>
          )}

          <div className="absolute top-0 right-0 flex items-center gap-1.5">
            {post.user.id === currentUserId && (
              <PostMoreButton
                className="opacity-0 transition-opacity group-hover/post:opacity-100"
                post={post}
              />
            )}
            <BookmarkButton
              className="h-6 w-6 p-0"
              initialState={{
                isBookmarkedByUser: post.bookmarks.some(
                  (bookmark) => bookmark.userId === currentUserId
                ),
              }}
              postId={post.id}
            />
          </div>
        </div>

        <Linkify>
          <div className={cn(!isExpanded && "line-clamp-6")} ref={contentRef}>
            <p className="wrap-break-word max-w-full whitespace-pre-wrap text-[15px] text-foreground leading-relaxed">
              {post.content}
            </p>
          </div>
        </Linkify>
        {isOverflowing ? (
          <button
            className="mt-1 cursor-pointer font-medium text-primary text-sm hover:underline"
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
          <div className="mt-2.5 max-w-full overflow-hidden">
            <MediaPreviews
              attachments={post.attachments}
              autoPlayVideos={detail}
              initialMediaIndex={initialMediaIndex}
              interactive={!isJoined}
              post={post}
            />
          </div>
        )}

        {post.tags?.length || post.mentions?.length ? (
          <PostMeta
            mentions={post.mentions.map((m) => m.user as unknown as UserData)}
            tags={post.tags as TagWithCount[]}
          />
        ) : null}

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
              className="flex h-8 cursor-default items-center gap-1.5 rounded-full px-2 text-muted-foreground"
              title="Views"
            >
              <Eye className="size-5" />
              <span className="text-sm tabular-nums">{post.viewCount}</span>
            </span>
            <ShareButton
              description={post.content}
              postId={post.id}
              thumbnail={post.attachments[0]?.url}
              title={post.content}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

interface CommentButtonProps {
  onClick: () => void;
  post: PostData;
}

function CommentButton({ post, onClick }: CommentButtonProps) {
  return (
    <button
      className="pill-3d-hover group inline-flex h-8 items-center justify-center gap-1 rounded-full border-0 px-2 font-medium text-muted-foreground text-sm active:translate-y-px"
      onClick={onClick}
      type="button"
    >
      <MessageSquare className="size-5" />
      <span className="font-medium text-sm tabular-nums">
        {post._count.comments}
      </span>
    </button>
  );
}

const PostCard: React.FC<PostCardProps> = ({
  post: initialPost,
  isJoined = false,
  detail = false,
  initialMediaIndex,
}) => {
  const { user } = useSession();
  const router = useRouter();
  const [post, setPost] = useState(initialPost);
  const [showComments, setShowComments] = useState(detail);
  const [isExpanded, setIsExpanded] = useState(detail);

  useEffect(() => {
    setPost(initialPost);
  }, [initialPost]);

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
      router.push(`/posts/${post.id}`);
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
        router.push(`/posts/${post.id}`);
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
      onToggleComments={handleToggleComments}
      onToggleExpand={handleToggleExpand}
      post={post}
    />
  );

  const commentsSection = showComments ? (
    <div className="border-border/60 border-t px-4 pt-2 pb-4">
      <Comments post={post} />
    </div>
  ) : null;

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className={`${post.hnStoryShare ? "hn-story-share" : ""} ${detail ? "cursor-default" : "cursor-pointer"}`}
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
    </motion.div>
  );
};

export default PostCard;
