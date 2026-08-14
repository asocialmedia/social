"use client";

import type { Media, PostData, PostsPage } from "@asm/db";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Flame, MessageSquare, Newspaper } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { useCallback, useMemo } from "react";
import { MdPlayArrow } from "react-icons/md";

import { useSession } from "@/app/(main)/session-provider";
import { ROW_HOVER_CLASS } from "@/components/home/sidebars/right/sidebar-styles";
import FollowButton from "@/components/layouts/follow-button";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import UserAvatar from "@/components/layouts/user-avatar";
import { useUserDataQuery } from "@/hooks/use-user-data-query";
import kyInstance from "@/lib/ky";
import { cn, formatNumber, formatRelativeDate } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

interface PostAuthorSidebarProps {
  post: PostData;
}

const PostRowSkeleton: React.FC = () => (
  <div className="flex items-center gap-2.5 px-2.5 py-2">
    <div className="bg-border/50 h-12 w-12 shrink-0 animate-pulse rounded-lg" />
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="bg-border/60 h-3.5 w-full animate-pulse rounded-md" />
      <div className="bg-border/60 h-3.5 w-3/4 animate-pulse rounded-md" />
      <div className="bg-border/40 h-3 w-24 animate-pulse rounded-md" />
    </div>
  </div>
);

const getMediaUrl = (mediaId: string) => `/api/media/${mediaId}`;

// Seek past the first frame so the thumbnail shows a meaningful frame
const seekToThumbnail = (event: React.SyntheticEvent<HTMLVideoElement>) => {
  const video = event.currentTarget;
  if (video.duration > 2) {
    video.currentTime = 2;
  }
};

const MediaThumb: React.FC<{ media: Media }> = ({ media }) => {
  if (media.type === "IMAGE") {
    return (
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg shadow-xs">
        <Image
          alt="Post media"
          className="object-cover"
          fill
          sizes="48px"
          src={getMediaUrl(media.id)}
          unoptimized
        />
      </div>
    );
  }

  if (media.type === "VIDEO") {
    return (
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-black shadow-xs">
        <video
          aria-label="Post video"
          className="absolute inset-0 h-full w-full object-cover"
          muted
          onLoadedMetadata={seekToThumbnail}
          playsInline
          poster={getMediaProxyUrl(media)}
          preload="metadata"
          src={getMediaUrl(media.id)}
        />
        <span className="absolute inset-0 m-auto flex size-6 items-center justify-center rounded-full bg-black/40 backdrop-blur-xs">
          <MdPlayArrow className="h-4 w-4 text-white" />
        </span>
      </div>
    );
  }

  return null;
};

// Compact relative timestamp with an explicit "ago" suffix (e.g. "5m ago")
const getRelativeAgo = (from: Date | string) => {
  try {
    const dateObj = typeof from === "string" ? new Date(from) : from;
    if (Number.isNaN(dateObj.getTime())) {
      return formatRelativeDate(from);
    }
    const diffMs = Date.now() - dateObj.getTime();
    const diffMinutes = Math.max(0, Math.floor(diffMs / (60 * 1000)));
    if (diffMinutes < 1) {
      return "just now";
    }
    if (diffMinutes < 60) {
      return `${diffMinutes}m ago`;
    }
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) {
      return `${diffDays}d ago`;
    }
    return formatRelativeDate(from);
  } catch {
    return formatRelativeDate(from);
  }
};

interface AuthorPostRowProps {
  post: PostData;
}

const AuthorPostRow: React.FC<AuthorPostRowProps> = ({ post }) => {
  const [firstMedia] = post.attachments;

  return (
    <Link
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-2.5 py-2",
        ROW_HOVER_CLASS
      )}
      href={`/posts/${post.id}`}
    >
      {firstMedia?.type === "IMAGE" || firstMedia?.type === "VIDEO" ? (
        <MediaThumb media={firstMedia} />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm leading-snug font-medium">
          {post.content || "View post"}
        </span>
        <span className="text-muted-foreground mt-1 flex items-center gap-2 text-xs transition-colors group-hover:text-inherit">
          <span className="shrink-0" suppressHydrationWarning>
            {getRelativeAgo(post.createdAt)}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            <Flame
              className={cn(
                "h-3 w-3 transition-colors group-hover:text-inherit",
                post.aura < 0 ? "text-[#7c5cff]" : "text-orange-500"
              )}
            />
            {formatNumber(post.aura)}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            <MessageSquare className="h-3 w-3" />
            {formatNumber(post._count.comments)}
          </span>
        </span>
      </span>
    </Link>
  );
};

const PostAuthorSidebar: React.FC<PostAuthorSidebarProps> = ({ post }) => {
  const { user: currentUser } = useSession();
  const { data: liveUser } = useUserDataQuery(post.user);

  const author = liveUser;
  const isOwnProfile = author.id === currentUser?.id;
  const isFollowedByUser = Boolean(author.followers?.length);
  const followerInfo = {
    followers: author._count.followers,
    isFollowedByUser,
  };

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      kyInstance
        .get(
          `/api/users/${author.id}/posts`,
          pageParam ? { searchParams: { cursor: pageParam } } : undefined
        )
        .json<PostsPage>(),
    queryKey: ["post-author-posts", author.id, post.id],
    staleTime: 1000 * 60,
  });

  const posts = useMemo(
    () =>
      data?.pages
        .flatMap((page) => page.posts)
        .filter((item) => item.id !== post.id) || [],
    [data?.pages, post.id]
  );

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);

  let postsBody: React.ReactNode;
  if (status === "pending") {
    postsBody = (
      <div className="flex flex-col gap-0.5">
        <PostRowSkeleton />
        <PostRowSkeleton />
        <PostRowSkeleton />
      </div>
    );
  } else if (status === "error") {
    postsBody = (
      <p className="text-muted-foreground px-3 py-2 text-sm">
        Couldn't load more posts.
      </p>
    );
  } else if (posts.length) {
    postsBody = (
      <InfiniteScrollContainer onBottomReached={handleBottomReached}>
        <div className="flex flex-col gap-0.5">
          {posts.map((item) => (
            <AuthorPostRow key={item.id} post={item} />
          ))}
          {isFetchingNextPage ? (
            <div className="flex justify-center py-2">
              <Flame className="h-4 w-4 animate-pulse text-orange-500" />
            </div>
          ) : null}
        </div>
      </InfiniteScrollContainer>
    );
  } else {
    postsBody = (
      <p className="text-muted-foreground px-3 py-2 text-sm">
        No other posts from @{author.username} yet.
      </p>
    );
  }

  return (
    <aside className="hide-native-scrollbar border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-l px-5 pt-2.5 pb-6 xl:flex">
      <div className="flex flex-col gap-4">
        {
          // Author profile card
        }
        <div className="sidebar-subcard rounded-2xl p-2">
          <Link
            className={cn(
              "group flex flex-col gap-2 rounded-xl px-2.5 py-2.5",
              ROW_HOVER_CLASS
            )}
            href={`/users/${author.username}`}
          >
            <div className="flex items-start gap-3">
              <UserAvatar avatarUrl={author.avatarUrl} className="h-11 w-11" />
              <div className="-mt-0.5 min-w-0 flex-1">
                <span className="block truncate font-bold group-hover:underline">
                  {author.displayName || author.username}
                </span>
                <span className="text-muted-foreground block truncate text-xs transition-colors group-hover:text-inherit">
                  @{author.username}
                </span>
                {author.bio ? (
                  <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs leading-snug">
                    {author.bio}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="text-muted-foreground flex items-center gap-3 text-xs">
              <span>
                <span className="text-foreground font-semibold">
                  {formatNumber(author._count.posts)}
                </span>{" "}
                Posts
              </span>
              <span>
                <span className="text-foreground font-semibold">
                  {formatNumber(followerInfo.followers)}
                </span>{" "}
                Followers
              </span>
              <span className="flex items-center gap-1">
                <Flame
                  className={cn(
                    "h-3.5 w-3.5",
                    author.aura < 0 ? "text-[#7c5cff]" : "text-orange-500"
                  )}
                />
                <span className="text-foreground font-semibold">
                  {formatNumber(author.aura)}
                </span>{" "}
                Aura
              </span>
            </div>
          </Link>

          <div className="px-2 pt-3 pb-1">
            {isOwnProfile ? (
              <Link
                className="follow-btn-3d flex h-8 w-full items-center justify-center rounded-md px-3 text-sm"
                href={`/users/${author.username}`}
              >
                View profile
              </Link>
            ) : (
              <FollowButton
                className="h-8 w-full px-3 text-sm"
                initialState={followerInfo}
                userId={author.id}
              />
            )}
          </div>
        </div>

        {
          // More from the author
        }
        <div className="sidebar-subcard rounded-2xl p-2">
          <div className="flex items-center gap-2 px-2 pt-0.5 pb-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
              <Newspaper className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-tight font-semibold">More from</p>
              <p className="text-foreground/80 truncate text-xs leading-tight font-medium">
                @{author.username}
              </p>
            </div>
            <Link
              className="text-muted-foreground hover:text-primary shrink-0 text-[11px] font-medium transition-colors"
              href={`/users/${author.username}`}
            >
              View all
            </Link>
          </div>
          <div className="pt-2 pb-1">{postsBody}</div>
        </div>
      </div>
    </aside>
  );
};

export default PostAuthorSidebar;
