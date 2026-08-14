"use client";

import type { PostData, UserData } from "@asm/db";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { CommentsRealtimeProvider } from "@/components/comments/comments-realtime-context";
import PostCard from "@/components/home/feedview/post-card";
import HomeFeed from "@/components/home/home-feed";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import FloatingPostEditor from "@/components/layouts/mobile/floating-post-editor";
import PostAuthorSidebar from "@/components/posts/post-author-sidebar";
import kyInstance from "@/lib/ky";

interface ClientPostProps {
  initialMediaIndex?: number;
  post: PostData;
  userData: UserData | null;
}

const ClientPost: React.FC<ClientPostProps> = ({
  post,
  userData,
  initialMediaIndex,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const searchParams = useSearchParams();

  // Deep link from a notification (?comment=<id>): scroll to the eddy once it
  // is rendered. Comments load asynchronously (and may be paginated), so retry
  // briefly and give up silently if it never appears.
  useEffect(() => {
    const commentId = searchParams.get("comment");
    if (!commentId) {
      return;
    }
    let attempts = 0;
    const interval = window.setInterval(() => {
      attempts += 1;
      const target = document.querySelector(`#comment-${commentId}`);
      if (target) {
        window.clearInterval(interval);
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (attempts >= 40) {
        window.clearInterval(interval);
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [searchParams]);

  // Record the visit so the recents card surfaces recently viewed posts, and
  // refresh it right away so the list updates without a manual reload. Guests
  // don't have visit history, so skip the request entirely.
  useEffect(() => {
    if (!isLoggedIn) {
      return;
    }
    const recordVisit = async () => {
      try {
        await kyInstance.post("/api/posts/visit", {
          json: { postId: post.id },
        });
        await queryClient.invalidateQueries({ queryKey: ["post-history"] });
      } catch {
        // Best-effort visit tracking; ignore failures
      }
    };

    void recordVisit();
  }, [post.id, queryClient, isLoggedIn]);

  const handleGoBack = useCallback(() => {
    // Go back in history when there's a prior entry, otherwise land on the
    // home feed (e.g. the post was opened directly via URL).
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }, [router]);

  return (
    <CommentsRealtimeProvider postId={post.id}>
      <div className="relative flex h-dvh overflow-hidden">
        <LeftSidebar userData={userData} />

        <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
          <div className="relative min-h-0 flex-1">
            <div
              className={`hide-native-scrollbar h-full overflow-x-hidden overflow-y-auto ${
                isLoggedIn ? "pb-24 lg:pb-0" : "pb-44 lg:pb-20"
              }`}
              ref={scrollRef}
            >
              <div className="flex shrink-0 items-center gap-2 bg-[hsl(var(--background-alt))] px-3 py-2">
                <button
                  aria-label="Go back"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10 active:translate-y-px"
                  onClick={handleGoBack}
                  type="button"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <h1 className="text-lg font-semibold">Post</h1>
              </div>
              <div>
                <PostCard
                  detail
                  initialMediaIndex={initialMediaIndex}
                  post={post}
                />
              </div>
              <div>
                <div className="flex items-center justify-between px-4 py-2">
                  <span className="text-sm font-semibold">
                    View more content
                  </span>
                  <Link
                    aria-label="View all posts on the global feed"
                    className="text-primary shrink-0 text-sm font-medium hover:underline"
                    href="/"
                  >
                    View all posts
                  </Link>
                </div>
                <HomeFeed excludePostId={post.id} variant="global" />
                <div className="border-border/60 mt-4 border-t" />
              </div>
            </div>
            <FeedScrollbar containerRef={scrollRef} />
          </div>
        </div>

        <PostAuthorSidebar post={post} />
        {isLoggedIn ? <FloatingPostEditor post={post} /> : null}
      </div>
    </CommentsRealtimeProvider>
  );
};

export default ClientPost;
