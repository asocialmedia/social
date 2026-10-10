"use client";

// oxlint-disable jsx-a11y/prefer-tag-over-role -- Vaul requires its div handle for pointer capture and has no asChild API

import type { PostData } from "@asm/db";
import {
  Drawer,
  DrawerHandle,
  DrawerOverlay,
  DrawerPortal,
  DrawerSurface,
  DrawerTitle,
} from "@asm/ui/shadui/drawer";
import { useState } from "react";

import { useMediaQuery } from "@/hooks/use-media-query";

import { GustsCommentsDrawer } from "./gusts-comments-drawer";

const SNAP_POINTS = [0.5, 1];

export function MobileGustEddies({
  open,
  onClose,
  post,
}: {
  open: boolean;
  onClose: () => void;
  post: PostData;
}) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [snap, setSnap] = useState<string | number | null>(0.5);
  const expanded = snap === 1;

  return (
    <Drawer
      activeSnapPoint={snap}
      fixed
      handleOnly
      onAnimationEnd={(nextOpen) => {
        if (!nextOpen) {
          setSnap(0.5);
        }
      }}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={open && isMobile}
      setActiveSnapPoint={setSnap}
      shouldScaleBackground={false}
      snapPoints={SNAP_POINTS}
      snapToSequentialPoint
    >
      <DrawerPortal>
        <DrawerOverlay className="bg-transparent" />
        <DrawerSurface
          aria-describedby={undefined}
          className="panel-3d fixed inset-x-0 bottom-0 z-50 flex h-[calc(100dvh-env(safe-area-inset-top))] max-h-dvh flex-col overflow-hidden rounded-t-3xl! rounded-b-none! outline-none motion-reduce:transition-none"
          style={{ transitionDuration: "300ms" }}
          data-testid="gust-eddies-sheet"
        >
          <DrawerTitle className="sr-only">Eddies</DrawerTitle>
          <div
            className="flex min-h-0 flex-col pb-[env(safe-area-inset-bottom)]"
            style={{ height: expanded ? "100%" : "50dvh" }}
          >
            <DrawerHandle
              aria-hidden={false}
              aria-expanded={expanded}
              aria-label={expanded ? "Collapse eddies" : "Expand eddies"}
              className="chip-3d mx-auto my-3! h-1.5! w-10! shrink-0 cursor-grab touch-none active:cursor-grabbing"
              style={{ background: "hsl(var(--muted))" }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSnap(expanded ? 0.5 : 1);
                } else if (
                  event.key === "ArrowUp" ||
                  event.key === "ArrowDown"
                ) {
                  event.preventDefault();
                  setSnap(event.key === "ArrowUp" ? 1 : 0.5);
                }
              }}
              role="button"
              tabIndex={0}
            />
            <GustsCommentsDrawer onClose={onClose} post={post} />
          </div>
        </DrawerSurface>
      </DrawerPortal>
    </Drawer>
  );
}
