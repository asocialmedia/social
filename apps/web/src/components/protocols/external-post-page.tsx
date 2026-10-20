"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import ClientPost, {
  HeaderBannerWash,
} from "@/app/(main)/posts/[postId]/client-post";
import { useSession } from "@/app/(main)/session-provider";
import { FeedErrorState } from "@/components/feeds/feed-error-state";
import MediaViewer from "@/components/home/feedview/media-viewer";
import MediaRouteSkeleton from "@/components/layouts/skeletons/media-route-skeleton";
import PostDetailSkeleton from "@/components/layouts/skeletons/post-detail-skeleton";
import kyInstance from "@/lib/ky";
import { getPostAttachments } from "@/lib/posts/post-normalize";
import { getPostMediaPath, getPostPath } from "@/lib/posts/post-url";
import { externalPostView } from "@/lib/posts/presentation";
import { withViewTransition } from "@/lib/view-transition";

import { ExternalDiscussion } from "./external-discussion";
import { useBlueskyProfile } from "./use-bluesky-profile";
import { useExternalPost } from "./use-external-post";

export function ExternalPostPage() {
  const params = useSearchParams();
  const uri = params.get("uri") ?? "";
  const router = useRouter();
  const query = useExternalPost(uri);

  const session = useSession();
  const isLoggedIn = Boolean(session.user);
  const queryClient = useQueryClient();
  const mediaIndex = params.get("media");
  const externalPostData = query.data;

  useEffect(() => {
    if (!isLoggedIn || !externalPostData || mediaIndex === null) {
      return;
    }
    const recordVisit = async () => {
      try {
        await kyInstance.post("/api/posts/visit", {
          json: {
            externalPost: externalPostData,
            postId: externalPostData.id,
            uri: externalPostData.id,
          },
        });
        await queryClient.invalidateQueries({ queryKey: ["post-history"] });
      } catch {
        // Best-effort
      }
    };
    void recordVisit();
  }, [isLoggedIn, externalPostData, mediaIndex, queryClient]);

  const uriActor = uri.startsWith("at://")
    ? (uri.slice(5).split("/")[0] ?? "")
    : "";
  const { data: externalAuthor } = useBlueskyProfile(uriActor);

  const fallbackBannerUrl =
    externalAuthor?.bannerUrl || externalAuthor?.avatarUrl || null;
  const fallbackTitle = externalAuthor?.displayName
    ? `${externalAuthor.displayName}'s Post`
    : "Post";
  const fallbackSubtitle = externalAuthor?.handle
    ? `@${externalAuthor.handle}`
    : "Bluesky";

  if (query.isPending) {
    return params.has("media") ? (
      <MediaRouteSkeleton />
    ) : (
      <PostDetailSkeleton />
    );
  }
  if (query.data) {
    const post = externalPostView(query.data);
    if (mediaIndex !== null && post.attachments.length) {
      return (
        <MediaViewer
          standalone
          isOpen
          initialIndex={Math.max(
            0,
            Math.min(Number(mediaIndex) || 0, post.attachments.length - 1)
          )}
          media={getPostAttachments(post)}
          post={post}
          onClose={() => {
            // Pop back to the post page if we have history, otherwise replace
            // to avoid pushing duplicate history entries that trap back navigation.
            if (typeof window !== "undefined" && window.history.length > 1) {
              withViewTransition(() => router.back());
            } else {
              withViewTransition(() => router.replace(getPostPath(post)));
            }
          }}
          onNavigate={(index) =>
            router.replace(getPostMediaPath(post, index), { scroll: false })
          }
        />
      );
    }
    return <ClientPost key={post.id} post={post} userData={null} />;
  }
  return (
    <main className="mx-auto w-full max-w-2xl">
      <div className="border-border/60 relative flex items-center gap-2.5 overflow-hidden border-b px-3 py-2">
        {fallbackBannerUrl ? (
          <HeaderBannerWash
            bannerUrl={fallbackBannerUrl}
            key={fallbackBannerUrl}
          />
        ) : null}
        <button
          aria-label="Go back"
          className="icon-btn-3d relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full transition-all! duration-300! ease-out! hover:scale-105 active:scale-95"
          onClick={() =>
            typeof window !== "undefined" && window.history.length > 1
              ? withViewTransition(() => router.back())
              : withViewTransition(() => router.push("/"))
          }
          type="button"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="relative z-10 min-w-0 flex-1">
          <h1 className="truncate text-base leading-tight font-semibold sm:text-lg">
            {fallbackTitle}
          </h1>
          {fallbackSubtitle ? (
            <p className="text-muted-foreground truncate text-xs leading-tight font-normal">
              {fallbackSubtitle}
            </p>
          ) : null}
        </div>
      </div>
      {query.isError ? (
        <FeedErrorState
          message="Couldn't load this Bluesky post."
          isRetrying={query.isFetching}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}
      {query.isSuccess ? (
        <>
          <p className="text-muted-foreground p-4">
            The source post is unavailable. asocialmedia discussion is
            preserved.
          </p>
          <ExternalDiscussion post={{ id: uri }} />
        </>
      ) : null}
    </main>
  );
}
