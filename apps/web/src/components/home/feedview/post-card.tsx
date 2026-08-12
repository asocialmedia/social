"use client";

import type { PostData, TagWithCount, UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
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
import { MentionTags } from "@/components/tags/mention-tags";
import { Tags } from "@/components/tags/tags";
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
  onMentionsChange: (newMentions: UserData[]) => void;
  onTagsChange: (newTags: TagWithCount[]) => void;
  onToggleComments: () => void;
  onToggleExpand: () => void;
  post: ExtendedPostData;
  showComments: boolean;
}

const PostContent: React.FC<PostContentProps> = ({
  currentUserId,
  isExpanded,
  onMentionsChange,
  onTagsChange,
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

  useLayoutEffect(() => {
    updateOverflow();
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
            <p className="max-w-full whitespace-pre-wrap break-words text-[15px] text-foreground leading-relaxed">
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
          <div className="mt-3 overflow-hidden border border-orange-500/30 bg-gradient-to-br from-orange-50/70 to-white dark:border-orange-500/20 dark:from-orange-950/10 dark:to-background/50">
            <HNStoryCard hnStory={post.hnStoryShare} />
          </div>
        ) : null}

        {!!post.attachments.length && (
          <div className="mt-2.5 max-w-full overflow-hidden">
            <MediaPreviews attachments={post.attachments} />
          </div>
        )}

        {post.tags && post.tags.length > 0 && (
          <div className="mt-2.5">
            <Tags
              isOwner={post.user.id === currentUserId}
              onTagsChange={onTagsChange}
              postId={post.id}
              tags={post.tags as TagWithCount[]}
            />
          </div>
        )}

        {post.mentions && post.mentions.length > 0 && (
          <div className="mt-2">
            <MentionTags
              isOwner={post.user.id === currentUserId}
              mentions={post.mentions.map((m) => m.user as unknown as UserData)}
              onMentionsChange={onMentionsChange}
              postId={post.id}
            />
          </div>
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
              className="flex cursor-default items-center gap-1.5 py-2 pr-1 text-muted-foreground"
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
            <Button
              asChild
              className="text-muted-foreground"
              size="sm"
              variant="ghost"
            >
              <Link href={`/posts/${post.id}`} suppressHydrationWarning>
                <ArrowUpRight className="h-5 w-5" />
              </Link>
            </Button>
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
    <Button
      className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
      onClick={onClick}
      size="sm"
      variant="ghost"
    >
      <MessageSquare className="size-5" />
      <span className="font-medium text-sm tabular-nums">
        {post._count.comments}
      </span>
    </Button>
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

  const handlePostUpdate = useCallback((updatedPost: PostData) => {
    setPost(updatedPost);
  }, []);

  const handleMentionsChange = useCallback(
    (newMentions: UserData[]) => {
      handlePostUpdate({
        ...post,
        mentions: newMentions.map((mentionUser) => ({
          id: `${post.id}-${mentionUser.id}`,
          postId: post.id,
          userId: mentionUser.id,
          user: mentionUser,
          createdAt: new Date(),
        })),
      });
    },
    [handlePostUpdate, post]
  );

  const handleTagsChange = useCallback(
    (newTags: TagWithCount[]) => {
      handlePostUpdate({
        ...post,
        tags: newTags,
      });
    },
    [handlePostUpdate, post]
  );

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
            <div className="absolute top-0 left-0 h-full w-1 rounded-full bg-gradient-to-b from-orange-400 to-yellow-500" />
          ) : null}
          <div className={`p-4 ${post.hnStoryShare ? "pl-5" : ""}`}>
            <PostContent
              currentUserId={currentUserId}
              isExpanded={isExpanded}
              onMentionsChange={handleMentionsChange}
              onTagsChange={handleTagsChange}
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
              onMentionsChange={handleMentionsChange}
              onTagsChange={handleTagsChange}
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
