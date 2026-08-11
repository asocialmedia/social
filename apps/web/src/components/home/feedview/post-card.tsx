"use client";

import type { PostData, TagWithCount, UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Card, CardContent } from "@asm/ui/shadui/card";
import { Separator } from "@asm/ui/shadui/separator";
import { ArrowUpRight, Eye, Flame, MessageSquare, Share2 } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/app/(main)/session-provider";
import Comments from "@/components/comments/comments";
import UserAvatar from "@/components/layouts/user-avatar";
import UserTooltip from "@/components/layouts/user-tooltip";
import AuraCount from "@/components/posts/aura-count";
import AuraVoteButton from "@/components/posts/aura-vote-button";
import BookmarkButton from "@/components/posts/bookmark-button";
import PostMoreButton from "@/components/posts/post-more-button";
import ViewTracker from "@/components/posts/view-counter";
import { MentionTags } from "@/components/tags/mention-tags";
import { Tags } from "@/components/tags/tags";
import Linkify from "@/helpers/global/linkify";
import { formatNumber, formatRelativeDate } from "@/lib/utils";
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

const PostCard: React.FC<PostCardProps> = ({
  post: initialPost,
  isJoined = false,
}) => {
  const { user } = useSession();
  const [post, setPost] = useState(initialPost);
  const [showComments, setShowComments] = useState(false);

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

  // biome-ignore lint/correctness/noNestedComponentDefinitions: PostContent uses extensive parent component state and props, making it reasonable to keep nested
  const PostContent = () => (
    <>
      {post.mentions && post.mentions.length > 0 && (
        <div className="mt-2 mb-3">
          <MentionTags
            isOwner={post.user.id === user.id}
            // biome-ignore lint/suspicious/noExplicitAny: Post.mentions comes from the database and is typed as 'any' there
            mentions={post.mentions.map((m) => m.user as any)}
            onMentionsChange={handleMentionsChange}
            postId={post.id}
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center space-x-2">
          <UserTooltip user={post.user}>
            <Link href={`/users/${post.user.username}`}>
              <UserAvatar avatarUrl={post.user.avatarUrl} />
            </Link>
          </UserTooltip>
          <div className="min-w-0">
            <UserTooltip user={post.user}>
              <Link href={`/users/${post.user.username}`}>
                <h3 className="truncate font-semibold text-foreground">
                  {post.user.displayName}
                </h3>
                <div className="flex items-center text-muted-foreground text-sm">
                  <Flame className="mr-1 h-4 w-4 text-orange-500" />
                  {formatNumber(post.user.aura)} aura
                </div>
              </Link>
            </UserTooltip>
            <Link href={`/posts/${post.id}`} suppressHydrationWarning>
              <p className="truncate text-muted-foreground text-sm hover:underline">
                {formatRelativeDate(post.createdAt)}
              </p>
            </Link>
          </div>
        </div>

        <div className="flex shrink-0 items-center space-x-2">
          {post.user.id === user.id && (
            <PostMoreButton
              className="opacity-0 transition-opacity group-hover/post:opacity-100"
              onUpdate={handlePostUpdate}
              post={post}
            />
          )}
          <Button
            className="flex items-center space-x-2 text-muted-foreground"
            size="sm"
            variant="ghost"
          >
            <Eye className="h-4 w-4" />
            <span className="text-sm tabular-nums">{post.viewCount}</span>
          </Button>
          <BookmarkButton
            initialState={{
              isBookmarkedByUser: post.bookmarks.some(
                (bookmark) => bookmark.userId === user.id
              ),
            }}
            postId={post.id}
          />
        </div>
      </div>

      <AuraCount initialAura={post.aura} postId={post.id} />

      {post.tags && post.tags.length > 0 && (
        <div className="mt-2 mb-2">
          <Tags
            isOwner={post.user.id === user.id}
            onTagsChange={handleTagsChange}
            postId={post.id}
            tags={post.tags as TagWithCount[]}
          />
        </div>
      )}

      <Linkify>
        <p className="mt-4 mb-4 max-w-full whitespace-pre-wrap break-words text-foreground">
          {post.content}
        </p>
      </Linkify>

      {post.hnStoryShare ? (
        <div className="mb-4">
          <div className="mb-2 flex items-center text-muted-foreground text-xs sm:text-sm">
            <Share2 className="mr-1.5 h-3.5 w-3.5 text-orange-500 sm:h-4 sm:w-4" />
            <span className="font-medium">Reshared from Hacker News</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-orange-500/30 bg-gradient-to-br from-orange-50/70 to-white dark:border-orange-500/20 dark:from-orange-950/10 dark:to-background/50">
            <HNStoryCard hnStory={post.hnStoryShare} />
          </div>
        </div>
      ) : null}

      {!!post.attachments.length && (
        <div className="max-w-full overflow-hidden">
          <MediaPreviews attachments={post.attachments} />
        </div>
      )}

      {!!post.attachments.length && <Separator className="mt-4" />}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <AuraVoteButton
          authorName={post.user.displayName}
          initialState={{
            aura: post.aura,
            userVote: post.vote[0]?.value || 0,
          }}
          postId={post.id}
        />
        <div className="flex items-center space-x-2">
          <CommentButton onClick={handleToggleComments} post={post} />
          <ShareButton
            description={post.content}
            postId={post.id}
            thumbnail={post.attachments[0]?.url}
            title={post.content}
          />
          <Link href={`/posts/${post.id}`} suppressHydrationWarning>
            <Button
              className="hover: text-muted-foreground"
              size="sm"
              variant="ghost"
            >
              <ArrowUpRight className="h-5 w-5" />
            </Button>
          </Link>
        </div>
      </div>
      {showComments ? <Comments post={post} /> : null}
    </>
  );

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
          className={`group/post rounded-none bg-[#1a1a1a] transition-colors duration-150 hover:bg-[#222222] ${post.hnStoryShare ? "relative border-l-2 border-l-orange-500 pb-1" : ""}`}
        >
          {post.hnStoryShare ? (
            <div className="absolute top-0 left-0 h-full w-1 rounded-full bg-gradient-to-b from-orange-400 to-yellow-500" />
          ) : null}
          <div className={`p-4 ${post.hnStoryShare ? "pl-5" : ""}`}>
            <PostContent />
          </div>
        </div>
      ) : (
        <Card
          className={`group/post rounded-none bg-[#1a1a1a] shadow-none transition-colors duration-150 hover:bg-[#222222] ${post.hnStoryShare ? "border-l-2 border-l-orange-500" : ""}`}
        >
          <CardContent className="p-4">
            <PostContent />
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
};

interface CommentButtonProps {
  onClick: () => void;
  post: PostData;
}

function CommentButton({ post, onClick }: CommentButtonProps) {
  return (
    <Button
      className="flex items-center space-x-2 text-muted-foreground hover:text-foreground"
      onClick={onClick}
      size="sm"
      variant="ghost"
    >
      <MessageSquare className="size-5" />
      <span className="font-medium text-sm tabular-nums">
        {post._count.comments} <span className="hidden sm:inline">Eddies</span>
      </span>
    </Button>
  );
}

export default PostCard;
