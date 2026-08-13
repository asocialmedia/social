"use client";

import type { PostData, UserData } from "@asm/db";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import PostCard from "@/components/home/feedview/post-card";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import PostAuthorSidebar from "@/components/posts/post-author-sidebar";

interface ClientPostProps {
  initialMediaIndex?: number;
  post: PostData;
  userData: UserData;
}

const ClientPost: React.FC<ClientPostProps> = ({
  post,
  userData,
  initialMediaIndex,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const handleGoBack = useCallback(() => {
    router.push("/");
  }, [router]);

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={userData} />

      <div className="mx-auto flex min-w-0 flex-1 flex-col border-border/60 bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <div className="relative min-h-0 flex-1">
          <div
            className="hide-native-scrollbar h-full overflow-y-auto overflow-x-hidden"
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
              <h1 className="font-semibold text-lg">Post</h1>
            </div>
            <div className="mt-3 border-border/60 border-b md:mt-0">
              <PostCard
                detail
                initialMediaIndex={initialMediaIndex}
                post={post}
              />
            </div>
          </div>
          <FeedScrollbar containerRef={scrollRef} />
        </div>
      </div>

      <PostAuthorSidebar post={post} />
    </div>
  );
};

export default ClientPost;
