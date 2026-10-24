"use client";

import type { PostsPage } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Eye,
  Flame,
  MessageSquare,
  Newspaper,
  Play,
  ShieldAlert,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { useCallback, useMemo } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { ROW_HOVER_CLASS } from "@/components/home/sidebars/right/sidebar-styles";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import FollowButton from "@/components/layouts/user/follow-button";
import UserAvatar from "@/components/layouts/user/user-avatar";
import UserBadge from "@/components/layouts/user/user-badge";
import { PostEngagementCount } from "@/components/posts/actions/post-engagement-count";
import ExplicitContentGate from "@/components/posts/content/explicit-content-gate";
import {
  embedImageProxyUrl,
  useEmbedImageError,
} from "@/components/posts/embeds/embed-utils";
import { BlueskyIcon } from "@/components/protocols/bluesky-icon";
import { useBlueskyProfile } from "@/components/protocols/use-bluesky-profile";
import { useUserDataQuery } from "@/hooks/users/use-user-data-query";
import { getAuraFlameClass } from "@/lib/aura/aura";
import kyInstance from "@/lib/ky";
import { parseStoredEmbeds } from "@/lib/link-embeds/shared";
import { externalAuthorView, externalPostView } from "@/lib/posts/presentation";
import type { PresentedPost as PostData } from "@/lib/posts/presentation";
import { blueskyProfilePath } from "@/lib/protocols/paths";
import { getPostPath } from "@/lib/seo/seo";
import { getUserCount, getUserPostCount } from "@/lib/types";
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

interface AuthorPostRowProps {
  post: PostData;
}

const AuthorPostRow: React.FC<AuthorPostRowProps> = ({ post }) => {
  const [firstMedia] = post.attachments ?? [];
  const embeds = parseStoredEmbeds(post.embeds);
  const firstEmbedWithImage = embeds.find((e) => Boolean(e.imageUrl));
  const embedImage = useEmbedImageError(firstEmbedWithImage?.imageUrl);

  let thumbnail: React.ReactNode = null;

  if (firstMedia?.type === "IMAGE" || firstMedia?.type === "VIDEO") {
    thumbnail = (
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-black shadow-xs">
        {post.explicitContent ? (
          <ExplicitContentGate
            className="h-full w-full"
            compact
            label="Explicit"
            revealKey={post.id}
          >
            <Image
              alt="Post media"
              className="object-cover"
              fill
              sizes="48px"
              src={getMediaProxyUrl(firstMedia)}
              unoptimized
            />
          </ExplicitContentGate>
        ) : (
          <Image
            alt="Post media"
            className="object-cover"
            fill
            sizes="48px"
            src={getMediaProxyUrl(firstMedia)}
            unoptimized
          />
        )}
        {firstMedia.type === "VIDEO" && !post.explicitContent ? (
          <span className="absolute inset-0 m-auto flex size-5 items-center justify-center rounded-full bg-black/40 backdrop-blur-xs">
            <Play className="h-3 w-3 fill-white text-white" />
          </span>
        ) : null}
      </div>
    );
  } else if (firstEmbedWithImage?.imageUrl && !embedImage.failed) {
    const isYoutube = firstEmbedWithImage.type === "youtube";
    const imgElement = (
      // eslint-disable-next-line @next/next/no-img-element -- dynamic third-party origin, optimizer rejects proxy paths
      <img
        alt={firstEmbedWithImage.title || "Link preview"}
        className="h-full w-full object-cover"
        loading="lazy"
        onError={embedImage.handleError}
        referrerPolicy="no-referrer"
        src={embedImageProxyUrl(firstEmbedWithImage.imageUrl)}
      />
    );
    thumbnail = (
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-black shadow-xs">
        {post.explicitContent ? (
          <ExplicitContentGate
            className="h-full w-full"
            compact
            label="Explicit"
            revealKey={post.id}
          >
            {imgElement}
          </ExplicitContentGate>
        ) : (
          imgElement
        )}
        {isYoutube && !post.explicitContent ? (
          <span className="absolute inset-0 m-auto flex size-5 items-center justify-center rounded-full bg-black/40 backdrop-blur-xs">
            <Play className="h-3 w-3 fill-white text-white" />
          </span>
        ) : null}
      </div>
    );
  }

  const destination = getPostPath(post);
  const commentsCount = post._count?.comments ?? 0;

  return (
    <Link
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-2.5 py-2",
        ROW_HOVER_CLASS
      )}
      href={destination}
    >
      {thumbnail}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="block truncate text-sm font-semibold">
            {post.user?.displayName || post.user?.username || "Anonymous"}
          </span>
          {post.external ? (
            <BlueskyIcon />
          ) : (
            <UserBadge
              badge={post.user?.badge}
              badges={post.user?.badges}
              communityRoles={post.user?.communityMemberships}
            />
          )}
        </span>

        {post.moderated ? (
          <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-sm leading-snug font-medium">
            <ShieldAlert className="size-3.5 shrink-0" />
            <span className="truncate">This post seemed harmful</span>
          </span>
        ) : (
          <span className="text-muted-foreground mt-0.5 line-clamp-2 block max-h-10 overflow-hidden text-sm leading-snug font-medium">
            {post.content ||
              (post.attachments?.length ? "Media post" : "View post")}
          </span>
        )}

        <span className="text-muted-foreground mt-1 flex items-center gap-2 text-xs transition-colors group-hover:text-inherit">
          <span className="shrink-0" suppressHydrationWarning>
            {formatRelativeDate(post.createdAt)}
          </span>
          <PostEngagementCount
            aura={post.aura}
            className="flex shrink-0 items-center gap-0.5"
            iconClassName="h-3 w-3 transition-colors group-hover:text-inherit"
            likeCount={
              post.external
                ? (post.external.upstreamCounts.likes ?? null)
                : undefined
            }
          />
          <span className="flex shrink-0 items-center gap-0.5">
            <MessageSquare
              className={cn("h-3 w-3", commentsCount > 0 && "fill-current")}
            />
            {formatNumber(commentsCount)}
          </span>
          {post.viewCount !== undefined && post.viewCount > 0 ? (
            <span className="flex shrink-0 items-center gap-0.5">
              <Eye className="h-3 w-3" />
              {formatNumber(post.viewCount)}
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  );
};

const PostAuthorSidebar: React.FC<PostAuthorSidebarProps> = ({ post }) => {
  const { user: currentUser } = useSession();
  const { data: liveUser } = useUserDataQuery(post.user, !post.external);
  const { data: externalAuthor } = useBlueskyProfile(
    post.external?.author.id ?? "",
    post.external?.author
  );

  const author =
    post.external && externalAuthor
      ? externalAuthorView(externalAuthor)
      : liveUser;
  const isOwnProfile = author.id === currentUser?.id;
  const isFollowedByUser = Boolean(author.followers?.length);
  const followerInfo = {
    followers:
      externalAuthor?.upstreamCounts.followers ??
      getUserCount(author, "followers"),
    isFollowedByUser,
  };

  const isExternal = Boolean(post.external);
  const authorActor = post.external?.author.id || post.external?.author.handle;

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    enabled: isExternal ? Boolean(authorActor) : Boolean(author.id),
    getNextPageParam: (lastPage: { nextCursor: string | null }) =>
      lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      if (isExternal && authorActor) {
        const params = new URLSearchParams({
          actor: authorActor,
          limit: "25",
          tab: "posts",
        });
        if (pageParam) {
          params.set("cursor", pageParam);
        }
        const response = await fetch(
          `/api/protocols/bluesky/profile?${params.toString()}`,
          { signal }
        );
        if (!response.ok) {
          throw new Error("Couldn't load external posts");
        }
        const payload = (await response.json()) as {
          cursor?: string | null;
          items?: ExternalPost[];
        };
        return {
          nextCursor: payload.cursor ?? null,
          posts: (payload.items ?? []).map(externalPostView),
        };
      }
      return kyInstance
        .get(
          `/api/users/${author.id}/posts`,
          pageParam
            ? {
                searchParams: { cursor: pageParam, excludeModerated: "1" },
                signal,
              }
            : { searchParams: { excludeModerated: "1" }, signal }
        )
        .json<PostsPage>();
    },
    queryKey: [
      "post-author-posts",
      isExternal ? `bluesky:${authorActor}` : author.id,
      post.id,
    ],
    staleTime: 1000 * 60,
  });

  const posts = useMemo(() => {
    const raw = data?.pages.flatMap((page) => page.posts) || [];
    const seen = new Set<string>();
    const result: PostData[] = [];
    for (const item of raw) {
      if (
        item.id === post.id ||
        (post.external && (item as PostData).external?.id === post.external.id)
      ) {
        continue;
      }
      if (!seen.has(item.id)) {
        seen.add(item.id);
        result.push(item);
      }
    }
    return result;
  }, [data?.pages, post.id, post.external]);

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      void fetchNextPage();
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
    <aside className="hide-native-scrollbar bg-background border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-l px-2.5 pt-2.5 pb-6 xl:flex">
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
            href={
              (post.external
                ? blueskyProfilePath(post.external.author.id)
                : undefined) ?? `/users/${author.username}`
            }
          >
            <div className="flex items-start gap-3">
              <UserAvatar avatarUrl={author.avatarUrl} className="h-11 w-11" />
              <div className="-mt-0.5 min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="block truncate font-bold group-hover:underline">
                    {author.displayName || author.username}
                  </span>
                  {post.external ? (
                    <BlueskyIcon />
                  ) : (
                    <UserBadge
                      badge={author.badge}
                      badges={author.badges}
                      communityRoles={author.communityMemberships}
                    />
                  )}
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
                  {post.external &&
                  externalAuthor?.upstreamCounts.posts === undefined
                    ? "…"
                    : formatNumber(
                        externalAuthor?.upstreamCounts.posts ??
                          getUserPostCount(author)
                      )}
                </span>{" "}
                Posts
              </span>
              <span>
                <span className="text-foreground font-semibold">
                  {post.external &&
                  externalAuthor?.upstreamCounts.followers === undefined
                    ? "…"
                    : formatNumber(followerInfo.followers)}
                </span>{" "}
                Followers
              </span>
              {post.external ? null : (
                <span className="flex items-center gap-1">
                  <Flame
                    className={cn(
                      "h-3.5 w-3.5",
                      getAuraFlameClass(author.aura)
                    )}
                  />
                  <span className="text-foreground font-semibold">
                    {formatNumber(author.aura)}
                  </span>{" "}
                  Aura
                </span>
              )}
            </div>
          </Link>

          <div className="px-2 pt-3 pb-1">
            {isOwnProfile || post.external ? (
              <Link
                className="follow-btn-3d flex h-8 w-full items-center justify-center rounded-md px-3 text-sm"
                href={
                  (post.external
                    ? blueskyProfilePath(post.external.author.id)
                    : undefined) ?? `/users/${author.username}`
                }
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
          <div className="flex items-center gap-2 px-2 pt-0.5 pb-1">
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white",
                post.external
                  ? "bg-linear-to-b from-[#1185fe] to-[#0060df] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(0,80,200,0.45),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(0,80,200,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
                  : "bg-linear-to-b from-[#ff9500] to-[#e65500] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.45),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
              )}
            >
              {post.external ? (
                <BlueskyIcon className="h-4 w-4 fill-white text-white" />
              ) : (
                <Newspaper className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-tight font-semibold">More from</p>
              <p className="text-foreground/80 truncate text-xs leading-tight font-medium">
                @{author.username}
              </p>
            </div>
            <Link
              className="text-muted-foreground hover:text-primary shrink-0 text-[11px] font-medium transition-colors"
              href={
                (post.external
                  ? blueskyProfilePath(post.external.author.id)
                  : undefined) ?? `/users/${author.username}`
              }
            >
              View all
            </Link>
          </div>
          <div className="pb-1">{postsBody}</div>
        </div>
      </div>
    </aside>
  );
};

export default PostAuthorSidebar;
