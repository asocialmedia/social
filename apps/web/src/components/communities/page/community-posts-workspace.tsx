"use client";

import {
  useMotionValue,
  useReducedMotion,
  animate,
  motion,
  useTransform,
} from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { ComponentProps, ReactNode, Ref } from "react";

import { FeedScrollbar } from "@/components/layouts/feed/feed-scrollbar";
import { useCommunityHeaderIdentity } from "@/hooks/use-community-header-identity";
import { attachCommunityHeaderSnap } from "@/lib/communities/header-snap";
import { communityHeaderFrame } from "@/lib/communities/header-transform";

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
  children?: ReactNode;
  navigationOpen?: boolean;
  navigationModalOpen?: boolean;
  onOpenNavigation?: () => void;
  navigationTriggerRef?: Ref<HTMLButtonElement>;
};

export default function CommunityPostsWorkspace({
  community,
  children,
  canReadContent = true,
  navigationOpen,
  navigationModalOpen,
  onOpenNavigation,
  navigationTriggerRef,
  ...headerProps
}: CommunityPostsWorkspaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const destinationRef = useRef<HTMLDivElement>(null);
  const getBoundary = useCallback(() => layerRef.current, []);
  const reducedMotion = useReducedMotion();
  const headerHeight = useMotionValue(0);
  const progress = useMotionValue(0);
  const layoutCompact = useMotionValue(0);
  const animationRef = useRef<{ stop: () => void } | null>(null);
  const frame = useTransform(() =>
    communityHeaderFrame(
      headerHeight.get(),
      progress.get(),
      layoutCompact.get()
    )
  );
  const layerY = useTransform(() => frame.get().layerY);
  const spacerHeight = useTransform(() => frame.get().spacerHeight);
  const feedY = useTransform(() => frame.get().feedY);
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

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || navigationModalOpen) {
      return;
    }
    const detach = attachCommunityHeaderSnap({
      initialCompact: layoutCompact.get() === 1 || viewport.scrollTop > 2,
      interactionTarget: window,
      onCompactChange: (compact) => {
        const endpoint = Number(compact);
        if (layoutCompact.get() === endpoint) {
          return;
        }
        animationRef.current?.stop();
        layoutCompact.set(endpoint);
        if (compact && viewport.scrollTop > 0) {
          viewport.scrollTo({
            behavior: "instant",
            top: Math.max(0, viewport.scrollTop - headerHeight.get()),
          });
        }
        if (reducedMotion) {
          progress.set(endpoint);
        } else {
          animationRef.current = animate(progress, endpoint, {
            damping: 44,
            mass: 0.7,
            stiffness: 500,
            type: "spring",
          });
        }
      },
      viewport,
    });
    return () => {
      detach();
      animationRef.current?.stop();
      progress.set(layoutCompact.get());
    };
  }, [
    headerHeight,
    layoutCompact,
    navigationModalOpen,
    progress,
    reducedMotion,
  ]);

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
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
        <motion.div
          className="pointer-events-none relative bg-[hsl(var(--background-alt))]"
          ref={layerRef}
          style={{ y: layerY }}
        >
          <div ref={headerRef}>
            <CommunityHeader
              community={community}
              canReadContent={canReadContent}
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
              showSections={canReadContent}
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
      </div>
      <section
        aria-label={`${community.name} posts`}
        className="hide-native-scrollbar relative h-full [scroll-padding-top:48px] overflow-x-hidden overflow-y-auto overscroll-y-contain pb-24 [overflow-anchor:none] lg:pb-0"
        ref={scrollRef}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- This scroll region must support keyboard scrolling independently of the fixed page shell.
        tabIndex={0}
      >
        <motion.div aria-hidden="true" style={{ height: spacerHeight }} />
        <motion.div className="min-h-[calc(100%_-_3rem)]" style={{ y: feedY }}>
          {children ??
            (canReadContent ? (
              <CommunityFeed slug={community.slug} scrollRef={scrollRef} />
            ) : null)}
        </motion.div>
      </section>
      <FeedScrollbar containerRef={scrollRef} />
    </div>
  );
}
