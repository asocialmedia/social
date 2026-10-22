"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useRef } from "react";
import type { ComponentProps, Ref } from "react";

import { FeedScrollbar } from "@/components/layouts/feed/feed-scrollbar";

import CommunityAvatar from "../card/community-avatar";
import CommunityFeed from "./community-feed";
import CommunityHeader from "./community-header";
import CommunitySectionNav from "./community-section-nav";

type CommunityPostsWorkspaceProps = ComponentProps<typeof CommunityHeader> & {
  navigationOpen: boolean;
  onOpenNavigation: () => void;
  navigationTriggerRef: Ref<HTMLButtonElement>;
};

export default function CommunityPostsWorkspace({
  community,
  navigationOpen,
  onOpenNavigation,
  navigationTriggerRef,
  ...headerProps
}: CommunityPostsWorkspaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    container: scrollRef,
    offset: ["end 72px", "end start"],
    target: headerRef,
  });
  const easedProgress = useSpring(scrollYProgress, {
    damping: 42,
    mass: 0.5,
    stiffness: 420,
  });
  const progress = reducedMotion ? scrollYProgress : easedProgress;
  const opacity = useTransform(progress, [0, 1], [0, 1]);
  const y = useTransform(progress, [0, 1], [reducedMotion ? 0 : 8, 0]);
  const scale = useTransform(progress, [0, 1], [reducedMotion ? 1 : 0.97, 1]);

  return (
    <div className="relative min-h-0 flex-1">
      <section
        aria-label={`${community.name} posts`}
        className="hide-native-scrollbar relative h-full [scroll-padding-top:48px] overflow-x-hidden overflow-y-auto overscroll-y-contain pb-24 lg:pb-0"
        ref={scrollRef}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- This scroll region must support keyboard scrolling independently of the fixed page shell.
        tabIndex={0}
      >
        <div ref={headerRef}>
          <CommunityHeader community={community} {...headerProps} />
        </div>
        <div className="sticky top-0 z-20 bg-[hsl(var(--background-alt))]">
          <CommunitySectionNav
            active="posts"
            accentColor={community.accentColor}
            slug={community.slug}
            navigationOpen={navigationOpen}
            onOpenNavigation={onOpenNavigation}
            navigationTriggerRef={navigationTriggerRef}
            identity={
              <div className="flex min-w-0 flex-1 items-center overflow-hidden">
                <motion.div
                  aria-hidden="true"
                  className="pointer-events-none flex min-w-0 origin-left items-center gap-2"
                  style={{ opacity, scale, y }}
                >
                  <CommunityAvatar
                    accentColor={community.accentColor}
                    avatarUrl={community.avatarUrl}
                    className="size-7 rounded-lg"
                    name={community.name}
                    slug={community.slug}
                  />
                  <span className="min-w-0 truncate text-sm font-semibold">
                    {community.name}{" "}
                    <span className="text-muted-foreground text-xs font-normal">
                      a/{community.slug}
                    </span>
                  </span>
                </motion.div>
              </div>
            }
          />
        </div>
        <CommunityFeed slug={community.slug} scrollRef={scrollRef} />
      </section>
      <FeedScrollbar containerRef={scrollRef} />
    </div>
  );
}
