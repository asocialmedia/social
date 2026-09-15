"use client";

import type { CommunityData } from "@asm/db";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import CommunityCard from "./community-card";

interface CommunityRailProps {
  auras: Record<string, number>;
  communities: CommunityData[];
  icon: LucideIcon;
  title: string;
}

// A Netflix-style row: a heading with a filled icon, and a horizontally
// snapping track of community cards. Left/right controls appear only when the
// track actually overflows in that direction, so a short row never shows a dead
// button. The controls scroll by just under a viewport of cards, keeping one
// card in view as an anchor.
export default function CommunityRail({
  auras,
  communities,
  icon: Icon,
  title,
}: CommunityRailProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = trackRef.current;
    if (!el) {
      return;
    }
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < maxScroll - 4);
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) {
      return;
    }
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      observer.disconnect();
    };
    // Re-measure when the row's contents change length; the ref itself never
    // changes identity so it is not a dependency.
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- length is the content trigger, not a value read
  }, [updateScrollState, communities.length]);

  const scrollByPage = useCallback((direction: -1 | 1) => {
    const el = trackRef.current;
    if (!el) {
      return;
    }
    el.scrollBy({
      behavior: "smooth",
      left: direction * Math.max(el.clientWidth * 0.85, 320),
    });
  }, []);

  if (communities.length === 0) {
    return null;
  }

  return (
    <section className="relative">
      <div className="mb-3 flex items-center gap-2.5 px-5 sm:px-8">
        <Icon className="text-primary size-5 shrink-0" fill="currentColor" />
        <h2 className="text-foreground text-lg font-bold tracking-tight">
          {title}
        </h2>
      </div>

      <div className="group/rail relative">
        {/* Controls are decorative duplicates of the scroll gesture; they are
            hidden from the a11y tree and never the only way to reach a card. */}
        {canScrollLeft ? (
          <RailArrow direction="left" onClick={() => scrollByPage(-1)} />
        ) : null}
        {canScrollRight ? (
          <RailArrow direction="right" onClick={() => scrollByPage(1)} />
        ) : null}

        <div
          className="hide-native-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain px-5 pb-1 sm:px-8"
          ref={trackRef}
        >
          {communities.map((community) => (
            <div
              className="community-card-w shrink-0 snap-start"
              key={community.id}
            >
              <CommunityCard
                aura={auras[community.id] ?? 0}
                community={community}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RailArrow({
  direction,
  onClick,
}: {
  direction: "left" | "right";
  onClick: () => void;
}) {
  const isLeft = direction === "left";
  const Icon = isLeft ? ChevronLeft : ChevronRight;
  return (
    <button
      aria-hidden="true"
      className={cn(
        "icon-btn-3d absolute top-1/2 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full",
        "opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100 focus-visible:opacity-100 md:flex",
        isLeft ? "left-2 sm:left-4" : "right-2 sm:right-4"
      )}
      onClick={onClick}
      tabIndex={-1}
      type="button"
    >
      <Icon className="size-5" />
    </button>
  );
}
