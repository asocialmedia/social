"use client";

import type { Media, PostData, PostsPage } from "@asm/db";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  FileAudio,
  FileCode,
  FileIcon,
  FileText,
  Flame,
  MessageSquare,
  Newspaper,
} from "lucide-react";
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

interface PostAuthorSidebarProps {
  post: PostData;
}

const SKELETON_KEYS = Array.from({ length: 6 }, (_, i) => `skeleton-${i}`);

const PostGridSkeleton: React.FC = () => (
  <div className="grid grid-cols-2 gap-2">
    {SKELETON_KEYS.map((key) => (
      <div
        className="animate-pulse rounded-lg bg-border/40"
        key={key}
        style={{ aspectRatio: "4 / 5" }}
      />
    ))}
  </div>
);

const getMediaUrl = (mediaId: string) => `/api/media/${mediaId}`;

const MediaGridThumb: React.FC<{ media: Media }> = ({ media }) => {
  if (media.type === "IMAGE") {
    return (
      <Image
        alt="Post media"
        className="object-cover transition-transform duration-300 group-hover:scale-105"
        fill
        sizes="100px"
        src={getMediaUrl(media.id)}
        unoptimized
      />
    );
  }

  if (media.type === "VIDEO") {
    return (
      <>
        <video
          aria-label="Post video"
          className="absolute inset-0 h-full w-full object-cover"
          muted
          playsInline
          preload="metadata"
          src={getMediaUrl(media.id)}
        />
        <span className="absolute inset-0 m-auto flex size-7 items-center justify-center rounded-full bg-black/40 backdrop-blur-xs transition-transform duration-300 group-hover:scale-110">
          <MdPlayArrow className="h-4 w-4 text-white" />
        </span>
      </>
    );
  }

  if (media.type === "AUDIO") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-primary/10">
        <FileAudio className="h-5 w-5 text-primary" />
      </div>
    );
  }

  if (media.type === "CODE") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-primary/10">
        <FileCode className="h-5 w-5 text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-primary/10">
      <FileIcon className="h-5 w-5 text-primary" />
    </div>
  );
};

interface AuthorPostTileProps {
  post: PostData;
}

const AuthorPostTile: React.FC<AuthorPostTileProps> = ({ post }) => {
  const [firstMedia] = post.attachments;

  return (
    <Link
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border/40 bg-[hsl(var(--background))] shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-border/70 hover:shadow-md"
      href={`/posts/${post.id}`}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden">
        {firstMedia ? (
          <>
            <MediaGridThumb media={firstMedia} />
            <div className="absolute inset-0 flex items-end bg-linear-to-t from-black/60 via-transparent to-transparent p-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <span className="line-clamp-2 font-medium text-[10px] text-white leading-tight">
                {post.content || "View post"}
              </span>
            </div>
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-start justify-between bg-linear-to-b from-primary/5 to-primary/10 p-2">
            <FileText className="h-4 w-4 text-primary" />
            <span className="line-clamp-3 font-medium text-[10px] leading-tight">
              {post.content || "View post"}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-1 border-border/40 border-t px-1.5 py-1">
        <span
          className="truncate text-[10px] text-muted-foreground"
          suppressHydrationWarning
        >
          {formatRelativeDate(post.createdAt)}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <Flame className="h-2.5 w-2.5 text-orange-500" />
          {formatNumber(post.aura)}
          <MessageSquare className="ml-0.5 h-2.5 w-2.5" />
          {formatNumber(post._count.comments)}
        </span>
      </div>
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
    queryKey: ["post-author-posts", author.id, post.id],
    queryFn: ({ pageParam }) =>
      kyInstance
        .get(
          `/api/users/${author.id}/posts`,
          pageParam ? { searchParams: { cursor: pageParam } } : undefined
        )
        .json<PostsPage>(),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
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
    postsBody = <PostGridSkeleton />;
  } else if (status === "error") {
    postsBody = (
      <p className="px-3 py-2 text-muted-foreground text-sm">
        Couldn't load more posts.
      </p>
    );
  } else if (posts.length) {
    postsBody = (
      <InfiniteScrollContainer onBottomReached={handleBottomReached}>
        <div className="grid grid-cols-2 gap-2">
          {posts.map((item) => (
            <AuthorPostTile key={item.id} post={item} />
          ))}
        </div>
        {isFetchingNextPage ? (
          <div className="flex justify-center py-2">
            <Flame className="h-4 w-4 animate-pulse text-orange-500" />
          </div>
        ) : null}
      </InfiniteScrollContainer>
    );
  } else {
    postsBody = (
      <p className="px-3 py-2 text-muted-foreground text-sm">
        No other posts from @{author.username} yet.
      </p>
    );
  }

  return (
    <aside className="hide-native-scrollbar sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-border/60 border-l px-5 pt-2.5 pb-6 xl:flex">
      <div className="flex flex-col gap-4">
        {/* Author profile card */}
        <div className="sidebar-subcard rounded-2xl p-2">
          <Link
            className={cn(
              "group flex flex-col gap-2 rounded-xl px-2.5 py-2.5",
              ROW_HOVER_CLASS
            )}
            href={`/users/${author.username}`}
          >
            <div className="flex items-center gap-3">
              <UserAvatar
                avatarUrl={author.avatarUrl}
                className="rounded-full ring-2 ring-background"
                size={44}
              />
              <div className="min-w-0 flex-1">
                <span className="block truncate font-bold group-hover:underline">
                  {author.displayName || author.username}
                </span>
                <span className="block truncate text-muted-foreground text-xs transition-colors group-hover:text-inherit">
                  @{author.username}
                </span>
              </div>
            </div>
            {author.bio ? (
              <p className="line-clamp-2 text-muted-foreground text-sm">
                {author.bio}
              </p>
            ) : null}
            <div className="flex items-center gap-3 text-muted-foreground text-xs">
              <span>
                <span className="font-semibold text-foreground">
                  {formatNumber(author._count.posts)}
                </span>{" "}
                Posts
              </span>
              <span>
                <span className="font-semibold text-foreground">
                  {formatNumber(followerInfo.followers)}
                </span>{" "}
                Followers
              </span>
              <span className="flex items-center gap-1">
                <Flame className="h-3.5 w-3.5 text-orange-500" />
                <span className="font-semibold text-foreground">
                  {formatNumber(author.aura)}
                </span>{" "}
                Aura
              </span>
            </div>
          </Link>

          <div className="px-2 pb-1">
            {isOwnProfile ? (
              <Link
                className="follow-btn-3d flex h-8 w-full items-center justify-center rounded-md px-3 text-sm"
                href={`/users/${author.username}`}
              >
                View profile
              </Link>
            ) : (
              <FollowButton
                className="follow-btn-3d h-8 w-full px-3 text-sm"
                initialState={followerInfo}
                userId={author.id}
              />
            )}
          </div>
        </div>

        {/* More from the author */}
        <div className="sidebar-subcard rounded-2xl p-2">
          <div className="flex items-center gap-2 border-border/60 border-b px-2 pt-0.5 pb-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
              <Newspaper className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm leading-tight">More from</p>
              <p className="truncate text-primary text-xs leading-tight">
                @{author.username}
              </p>
            </div>
            <Link
              className="shrink-0 font-medium text-[11px] text-muted-foreground transition-colors hover:text-primary"
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
