"use client";

import type { PostData, TagWithCount, UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Card, CardContent } from "@asm/ui/shadui/card";
import { ArrowUpRight, Eye, MessageSquare } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
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
import { formatRelativeDate } from "@/lib/utils";
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
    <div className="flex gap-3">
      <UserTooltip user={post.user}>
        <Link className="shrink-0" href={`/users/${post.user.username}`}>
          <UserAvatar avatarUrl={post.user.avatarUrl} className="h-10 w-10" />
        </Link>
      </UserTooltip>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
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

          <div className="flex shrink-0 items-start gap-1">
            {post.user.id === user.id && (
              <PostMoreButton
                className="opacity-0 transition-opacity group-hover/post:opacity-100"
                onUpdate={handlePostUpdate}
                post={post}
              />
            )}
            <BookmarkButton
              className="h-5 w-5 p-0"
              initialState={{
                isBookmarkedByUser: post.bookmarks.some(
                  (bookmark) => bookmark.userId === user.id
                ),
              }}
              postId={post.id}
            />
          </div>
        </div>

        <Linkify>
          <p className="max-w-full whitespace-pre-wrap break-words text-[15px] text-foreground leading-relaxed">
            {post.content}
          </p>
        </Linkify>

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
              isOwner={post.user.id === user.id}
              onTagsChange={handleTagsChange}
              postId={post.id}
              tags={post.tags as TagWithCount[]}
            />
          </div>
        )}

        {post.mentions && post.mentions.length > 0 && (
          <div className="mt-2">
            <MentionTags
              isOwner={post.user.id === user.id}
              // biome-ignore lint/suspicious/noExplicitAny: Post.mentions comes from the database and is typed as 'any' there
              mentions={post.mentions.map((m) => m.user as any)}
              onMentionsChange={handleMentionsChange}
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
            <CommentButton onClick={handleToggleComments} post={post} />
          </div>

          <div className="flex items-center gap-1">
            <Button
              className="flex cursor-default items-center gap-1.5 text-muted-foreground hover:bg-transparent"
              size="sm"
              variant="ghost"
            >
              <Eye className="size-5" />
              <span className="text-sm tabular-nums">{post.viewCount}</span>
            </Button>
            <ShareButton
              description={post.content}
              postId={post.id}
              thumbnail={post.attachments[0]?.url}
              title={post.content}
            />
            <Link href={`/posts/${post.id}`} suppressHydrationWarning>
              <Button
                className="text-muted-foreground"
                size="sm"
                variant="ghost"
              >
                <ArrowUpRight className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
        {showComments ? <Comments post={post} /> : null}
      </div>
    </div>
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

export default PostCard;
