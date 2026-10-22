"use client";

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useCallback, useLayoutEffect, useRef } from "react";
import type { ComponentProps, Ref } from "react";

import { FeedScrollbar } from "@/components/layouts/feed/feed-scrollbar";
import { useCommunityHeaderIdentity } from "@/hooks/use-community-header-identity";

import CommunityFeed from "./community-feed";
import CommunityHeader from "./community-header";
import CommunitySectionNav from "./community-section-nav";

type CommunityPostsWorkspaceProps = Omit<
  ComponentProps<typeof CommunityHeader>,
  | "avatarRef"
  | "avatarStyle"
  | "nameRef"
  | "nameStyle"
  | "slugRef"
  | "slugStyle"
  | "detailsStyle"
> & {
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
  const stickyRef = useRef<HTMLDivElement>(null);
  const destinationRef = useRef<HTMLDivElement>(null);
  const getBoundary = useCallback(() => stickyRef.current, []);
  const reducedMotion = useReducedMotion();
  const headerHeight = useMotionValue(0);
  const stickyTop = useTransform(headerHeight, (height) => -height);
  const { scrollY } = useScroll({ container: scrollRef });
  const rawProgress = useTransform(() => {
    const height = headerHeight.get();
    const fraction =
      height > 0 ? Math.max(0, Math.min(1, scrollY.get() / height)) : 0;
    return reducedMotion ? Number(fraction >= 1) : fraction;
  });
  const easedProgress = useSpring(rawProgress, {
    damping: 42,
    mass: 0.5,
    stiffness: 420,
  });
  const progress = reducedMotion ? rawProgress : easedProgress;
  const {
    attachSource: avatarRef,
    attachTarget: avatarTargetRef,
    measure: measureAvatar,
    style: avatarStyle,
  } = useCommunityHeaderIdentity(progress, getBoundary, "avatar");
  const {
    attachSource: nameRef,
    attachTarget: nameTargetRef,
    measure: measureName,
    style: nameStyle,
  } = useCommunityHeaderIdentity(progress, getBoundary, "text");
  const {
    attachSource: slugRef,
    attachTarget: slugTargetRef,
    measure: measureSlug,
    style: slugStyle,
  } = useCommunityHeaderIdentity(progress, getBoundary, "text");
  const detailsOpacity = useTransform(progress, [0, 0.5], [1, 0]);

  useLayoutEffect(() => {
    const header = headerRef.current;
    const destination = destinationRef.current;
    if (!header || !destination) {
      return;
    }
    const measure = () => {
      headerHeight.set(header.offsetHeight);
      measureAvatar();
      measureName();
      measureSlug();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    observer.observe(destination);
    let active = true;
    const measureFonts = async () => {
      await document.fonts.ready;
      if (active) {
        measure();
      }
    };
    void measureFonts();
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [headerHeight, measureAvatar, measureName, measureSlug]);

  return (
    <div className="relative min-h-0 flex-1">
      <section
        aria-label={`${community.name} posts`}
        className="hide-native-scrollbar relative h-full [scroll-padding-top:48px] overflow-x-hidden overflow-y-auto overscroll-y-contain pb-24 lg:pb-0"
        ref={scrollRef}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- This scroll region must support keyboard scrolling independently of the fixed page shell.
        tabIndex={0}
      >
        <motion.div
          ref={stickyRef}
          className="sticky z-20"
          style={{ top: stickyTop }}
        >
          <div ref={headerRef}>
            <CommunityHeader
              community={community}
              {...headerProps}
              avatarRef={avatarRef}
              avatarStyle={avatarStyle}
              nameRef={nameRef}
              nameStyle={nameStyle}
              slugRef={slugRef}
              slugStyle={slugStyle}
              detailsStyle={{ opacity: detailsOpacity }}
            />
          </div>
          <div className="relative z-20 bg-[hsl(var(--background-alt))]">
            <CommunitySectionNav
              active="posts"
              accentColor={community.accentColor}
              slug={community.slug}
              navigationOpen={navigationOpen}
              onOpenNavigation={onOpenNavigation}
              navigationTriggerRef={navigationTriggerRef}
              identity={
                <div
                  aria-hidden="true"
                  className="invisible flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
                  ref={destinationRef}
                >
                  <div className="size-7 shrink-0" ref={avatarTargetRef} />
                  <div
                    className="min-w-0 truncate text-sm font-bold"
                    ref={nameTargetRef}
                  >
                    {community.name}
                  </div>
                  <div className="min-w-0 truncate text-xs" ref={slugTargetRef}>
                    a/{community.slug}
                  </div>
                </div>
              }
            />
          </div>
        </motion.div>
        <CommunityFeed slug={community.slug} scrollRef={scrollRef} />
      </section>
      <FeedScrollbar containerRef={scrollRef} />
    </div>
  );
}
