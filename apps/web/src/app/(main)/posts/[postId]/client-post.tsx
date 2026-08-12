"use client";

import type { PostData, UserData } from "@asm/db";
import { useRef } from "react";
import PostCard from "@/components/home/feedview/post-card";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import PostAuthorSidebar from "@/components/posts/post-author-sidebar";

interface ClientPostProps {
  post: PostData;
  userData: UserData;
}

const ClientPost: React.FC<ClientPostProps> = ({ post, userData }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={userData} />

      <div className="mx-auto flex min-w-0 flex-1 flex-col border-border/60 bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
          <MobileTopBar />
        </div>

        <div className="relative min-h-0 flex-1">
          <div
            className="hide-native-scrollbar h-full overflow-y-auto overflow-x-hidden"
            ref={scrollRef}
          >
            <div className="border-border/60 border-b">
              <PostCard detail post={post} />
            </div>
          </div>
          <FeedScrollbar containerRef={scrollRef} />
        </div>
      </div>

      <PostAuthorSidebar post={post} />
      <MobileBottomNav />
    </div>
  );
};

export default ClientPost;
