"use client";

import type { PostData, TagWithCount, UserData } from "@asm/db";
import { Card, CardContent } from "@asm/ui/shadui/card";
import { ArrowUpRight, Eye, MessageSquare } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
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
import UserAvatar from "@/components/layouts/user-avatar";
import UserTooltip from "@/components/layouts/user-tooltip";
import AuraVoteButton from "@/components/posts/aura-vote-button";
import BookmarkButton from "@/components/posts/bookmark-button";
import PostMoreButton from "@/components/posts/post-more-button";
import ViewTracker from "@/components/posts/view-counter";
import { PostMeta } from "@/components/tags/post-meta";
import Linkify from "@/helpers/global/linkify";
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
  isJoined?: boolean;
  post: ExtendedPostData;
}

interface PostContentProps {
  currentUserId: string;
  isExpanded: boolean;
  onToggleComments: () => void;
  onToggleExpand: () => void;
  post: ExtendedPostData;
  showComments: boolean;
}

const PostContent: React.FC<PostContentProps> = ({
  currentUserId,
  isExpanded,
  onToggleComments,
  onToggleExpand,
  post,
  showComments,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const updateOverflow = useCallback(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    setIsOverflowing(el.scrollHeight > el.clientHeight);
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
      <UserTooltip user={post.user}>
        <Link className="shrink-0" href={`/users/${post.user.username}`}>
          <UserAvatar avatarUrl={post.user.avatarUrl} className="h-10 w-10" />
        </Link>
      </UserTooltip>

      <div className="min-w-0 flex-1">
        <div className="relative flex items-start gap-2">
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
        {isExpanded || isOverflowing ? (
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
            <MediaPreviews attachments={post.attachments} />
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
            <Link
              aria-label={`View post ${post.id}`}
              className="pill-3d-hover group inline-flex h-8 items-center justify-center rounded-full border-0 px-2 text-muted-foreground active:translate-y-px"
              href={`/posts/${post.id}`}
              suppressHydrationWarning
            >
              <ArrowUpRight className="h-5 w-5" />
            </Link>
          </div>
        </div>
        {showComments ? <Comments post={post} /> : null}
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
}) => {
  const { user } = useSession();
  const [post, setPost] = useState(initialPost);
  const [showComments, setShowComments] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

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

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={post.hnStoryShare ? "hn-story-share" : ""}
      id={`post-${post.id}`}
      initial={{ opacity: 0, y: 50 }}
      transition={{ duration: 0.5 }}
    >
      <ViewTracker postId={post.id} />
      {isJoined ? (
        <div
          className={`group/post rounded-none bg-[hsl(var(--background-alt))] transition-colors duration-150 hover:bg-[hsl(var(--muted))] ${post.hnStoryShare ? "relative border-l-2 border-l-orange-500 pb-1" : ""}`}
        >
          {post.hnStoryShare ? (
            <div className="absolute top-0 left-0 h-full w-1 rounded-full bg-linear-to-b from-orange-400 to-yellow-500" />
          ) : null}
          <div className={`p-4 ${post.hnStoryShare ? "pl-5" : ""}`}>
            <PostContent
              currentUserId={currentUserId}
              isExpanded={isExpanded}
              onToggleComments={handleToggleComments}
              onToggleExpand={handleToggleExpand}
              post={post}
              showComments={showComments}
            />
          </div>
        </div>
      ) : (
        <Card
          className={`group/post rounded-none bg-[hsl(var(--background-alt))] shadow-none transition-colors duration-150 hover:bg-[hsl(var(--muted))] ${post.hnStoryShare ? "border-l-2 border-l-orange-500" : ""}`}
        >
          <CardContent className="p-4">
            <PostContent
              currentUserId={currentUserId}
              isExpanded={isExpanded}
              onToggleComments={handleToggleComments}
              onToggleExpand={handleToggleExpand}
              post={post}
              showComments={showComments}
            />
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
};

export default PostCard;
