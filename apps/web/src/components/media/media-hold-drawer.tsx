"use client";

import type { PostData } from "@asm/db";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Media } from "@/lib/types";

import { createMediaHoldGesture, findHeldMedia } from "./media-hold-gesture";
import { MediaHoldPreview } from "./media-hold-preview";
import type { MediaHoldRequest } from "./media-hold-preview";

export function MediaHoldDrawer({
  children,
  enabled = true,
  media,
  post,
}: {
  children: ReactNode;
  enabled?: boolean;
  media: (Media & {
    post?: { explicitContent: boolean; moderated: boolean; id: string } | null;
  })[];
  post?: PostData;
}) {
  const gesture = useMemo(() => createMediaHoldGesture(), []);
  const [request, setRequest] = useState<MediaHoldRequest | null>(null);
  const closeRequest = useCallback(() => setRequest(null), []);
  useEffect(() => {
    const release = (event: PointerEvent) => gesture.release(event.pointerId);
    const move = (event: PointerEvent) =>
      gesture.move(event.pointerId, event.clientX, event.clientY);
    const cancel = () => gesture.cancel();
    const interrupt = () => gesture.interrupt();
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("scroll", cancel, true);
    window.addEventListener("blur", interrupt);
    document.addEventListener("visibilitychange", interrupt);
    return () => {
      cancel();
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("scroll", cancel, true);
      window.removeEventListener("blur", interrupt);
      document.removeEventListener("visibilitychange", interrupt);
    };
  }, [gesture]);
  useEffect(() => {
    if (!enabled) {
      gesture.cancel();
    }
  }, [enabled, gesture]);
  return (
    <div
      className="max-md:select-none max-md:[&_img]:[-webkit-touch-callout:none] max-md:[&_video]:[-webkit-touch-callout:none]"
      onPointerDownCapture={(event) => {
        if (
          !enabled ||
          request ||
          event.button !== 0 ||
          !event.isPrimary ||
          !matchMedia("(max-width: 767px)").matches ||
          !(event.target instanceof Element)
        ) {
          gesture.cancel();
          return;
        }
        const held = findHeldMedia(event.target, media);
        if (!held) {
          return;
        }
        const selected = media[held.index];
        if (
          !selected ||
          !["IMAGE", "VIDEO"].includes(selected.type) ||
          (!post && !selected.post) ||
          selected.post?.explicitContent ||
          selected.post?.moderated
        ) {
          return;
        }
        gesture.start(event.pointerId, event.clientX, event.clientY, () => {
          if (!held.element.isConnected) {
            return;
          }
          const rect = held.element.getBoundingClientRect();
          setRequest({
            bounds: {
              height: rect.height,
              width: rect.width,
              x: rect.x,
              y: rect.y,
            },
            media: selected,
            post,
            postId: post?.id ?? selected.post?.id ?? "",
            sourceVideo:
              held.element instanceof HTMLVideoElement
                ? held.element
                : (held.element.parentElement?.querySelector("video") ??
                  undefined),
          });
          navigator.vibrate?.(12);
        });
      }}
      onPointerLeave={() => gesture.cancel()}
      onContextMenu={(event) => {
        if (gesture.isPending() || gesture.suppressClick() || request) {
          event.preventDefault();
        }
      }}
      onDragStart={(event) => {
        if (matchMedia("(max-width: 767px)").matches) {
          event.preventDefault();
        }
      }}
      onClickCapture={(event) => {
        if (
          (gesture.suppressClick() || request) &&
          !(
            event.target instanceof Element &&
            event.target.closest("[data-media-hold-portal]")
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {children}
      {request ? (
        <MediaHoldPreview request={request} onClose={closeRequest} />
      ) : null}
    </div>
  );
}
