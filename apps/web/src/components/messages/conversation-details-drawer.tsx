"use client";

import { Drawer, DrawerContent, DrawerHandle } from "@asm/ui/shadui/drawer";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { detailsDrawerRadius } from "./details-drawer-radius";

const DETAILS_SNAP_POINTS = [0.6, 1];

export function ConversationDetailsDrawer({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [snapPoint, setSnapPoint] = useState<number | string | null>(0.6);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const radiusFrame = useRef<number | null>(null);
  const currentSnapPoint = useRef<number | string | null>(0.6);

  const cancelRadiusFrame = () => {
    if (radiusFrame.current !== null) {
      cancelAnimationFrame(radiusFrame.current);
      radiusFrame.current = null;
    }
  };
  const settleRadius = () => {
    cancelRadiusFrame();
    contentRef.current?.style.setProperty(
      "--details-corner-radius",
      currentSnapPoint.current === 1 ? "0px" : "16px"
    );
  };
  const updateDragRadius = () => {
    if (radiusFrame.current !== null) {
      return;
    }
    radiusFrame.current = requestAnimationFrame(() => {
      radiusFrame.current = null;
      const content = contentRef.current;
      if (!content?.classList.contains("vaul-dragging")) {
        return;
      }
      // Vaul writes the translation inline. Reading it avoids a layout measure.
      const translation = /translate3d\(0,\s*(?<offset>-?[\d.]+)px,/u.exec(
        content.style.transform
      );
      const offset = translation?.groups?.offset;
      if (offset !== undefined) {
        const radius = detailsDrawerRadius(
          Number(offset),
          window.innerHeight * 0.4
        );
        content.style.setProperty("--details-corner-radius", `${radius}px`);
      }
    });
  };

  useEffect(
    () => () => {
      if (radiusFrame.current !== null) {
        cancelAnimationFrame(radiusFrame.current);
      }
    },
    []
  );

  return (
    <Drawer
      activeSnapPoint={snapPoint}
      autoFocus
      fadeFromIndex={0}
      // Keep the parent mounted until the drawer completes its exit transition.
      onAnimationEnd={(open) => {
        if (!open) {
          onClose();
        }
      }}
      onOpenChange={setIsOpen}
      onRelease={settleRadius}
      open={isOpen}
      setActiveSnapPoint={(point) => {
        currentSnapPoint.current = point;
        setSnapPoint(point);
        settleRadius();
      }}
      shouldScaleBackground={false}
      snapPoints={DETAILS_SNAP_POINTS}
      snapToSequentialPoint
    >
      <DrawerContent
        className="mt-0 h-[100dvh] max-h-[100dvh] gap-0 overflow-hidden rounded-t-[var(--details-corner-radius,16px)]! rounded-b-none! p-0 transition-[transform,border-top-left-radius,border-top-right-radius]! duration-500! ease-[cubic-bezier(0.32,0.72,0,1)]! motion-reduce:transition-none! [&.vaul-dragging]:transition-none!"
        onPointerMove={updateDragRadius}
        ref={contentRef}
        showHandle={false}
      >
        <DrawerHandle
          className="absolute! top-3 left-1/2 z-10 -translate-x-1/2"
          preventCycle
        />
        <button
          aria-label="Close chat details"
          className="bg-background/70 text-foreground border-border/60 hover:bg-background/90 absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 z-10 flex size-11 items-center justify-center rounded-full border backdrop-blur-md transition-colors"
          data-vaul-no-drag
          onClick={() => setIsOpen(false)}
          type="button"
        >
          <X className="size-4" />
        </button>
        <button
          className="sr-only focus:not-sr-only"
          data-vaul-no-drag
          onClick={() => {
            currentSnapPoint.current = snapPoint === 1 ? 0.6 : 1;
            setSnapPoint(currentSnapPoint.current);
            settleRadius();
          }}
          type="button"
        >
          {snapPoint === 1 ? "Collapse chat details" : "Expand chat details"}
        </button>
        {/* Fit the scrollable body to the visible snap height, so bottom controls
            stay reachable at 60% instead of sitting below the viewport. */}
        <div className="flex h-[calc(100dvh-var(--snap-point-height,40dvh))] min-h-0 flex-col pb-[env(safe-area-inset-bottom)] transition-[height] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none">
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
