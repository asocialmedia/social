"use client";

import type { PostsPage } from "@asm/db";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";
import RightSideBar from "@/components/home/sidebars/right-side-bar";
import { FeedScrollbar } from "@/components/layouts/feed/feed-scrollbar";
import MobileBottomNav from "@/components/layouts/navigation/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/navigation/mobile/mobile-top-bar";
import SearchField from "@/components/layouts/navigation/search-field";
import { CollapsibleTopBar } from "@/components/layouts/shell/collapsible-top-bar";
import HashtagFeed from "@/components/posts/views/hashtag-feed";
import { FeedSourceMenu } from "@/components/protocols/feed-source-menu";
import { useFeedScrollMemory } from "@/hooks/feed/use-feed-scroll-memory";
import { useHideOnScroll } from "@/hooks/use-hide-on-scroll";
import { useFeedSourceStore } from "@/store/feed-source-store";

export default function HashtagFeedPage({
  tag,
  initialGuestPage,
}: {
  tag: string;
  initialGuestPage?: PostsPage;
}) {
  const { user } = useSession();
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const source = useFeedSourceStore((state) => state.source);
  const hideTopBar = useHideOnScroll(feedScrollRef);
  useFeedScrollMemory({
    containerRef: feedScrollRef,
    memoryKey: `hashtag:${tag}:${source}`,
  });

  return (
    <>
      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 backdrop-blur-md">
            <CollapsibleTopBar hidden={hideTopBar}>
              <MobileTopBar />
            </CollapsibleTopBar>
            <div className="border-border/60 relative grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center border-b py-1.5 md:flex">
              <div className="flex shrink-0 items-center justify-center md:w-11">
                <Link
                  aria-label="Back to home"
                  className="icon-btn-3d flex size-8 items-center justify-center rounded-full"
                  href="/"
                >
                  <ArrowLeft aria-hidden className="size-4" />
                </Link>
              </div>
              <div className="relative min-w-0 px-3 py-3 text-center md:flex-1 md:text-left">
                <h1 className="text-foreground truncate text-sm font-semibold">
                  #{tag}
                </h1>
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 flex justify-center md:justify-start md:pl-3"
                >
                  <span className="h-1 w-6 rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500]" />
                </span>
              </div>
              <div className="flex items-center justify-center">
                <FeedSourceMenu following={false} />
              </div>
              <div aria-hidden className="hidden w-2 shrink-0 md:block" />
              <div className="ml-auto hidden min-w-0 items-center gap-2 pr-1.5 md:flex xl:hidden">
                <div className="w-full max-w-[24rem] xl:max-w-md">
                  <SearchField />
                </div>
              </div>
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            <div
              className={`hide-native-scrollbar h-full touch-pan-y overflow-x-hidden overflow-y-auto ${user ? "pb-24 lg:pb-0" : "pb-44 lg:pb-20"}`}
              ref={feedScrollRef}
            >
              <div className="mt-0 pb-12">
                <HashtagFeed
                  key={tag}
                  tag={tag}
                  initialGuestPage={initialGuestPage}
                />
              </div>
            </div>
            <FeedScrollbar containerRef={feedScrollRef} />
          </div>
        </div>
      </div>
      <RightSideBar />
      <MobileBottomNav />
    </>
  );
}
