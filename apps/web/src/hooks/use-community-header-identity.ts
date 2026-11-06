import { useMotionValue, useTransform } from "motion/react";
import type { MotionValue } from "motion/react";
import { useCallback, useRef } from "react";

import { communityIdentityTransform } from "@/lib/communities/header-transform";
import type { HeaderIdentityGeometry } from "@/lib/communities/header-transform";

function layoutPosition(element: HTMLElement, boundary: HTMLElement) {
  let x = 0;
  let y = 0;
  let current: HTMLElement | null = element;
  while (current && current !== boundary) {
    x += current.offsetLeft;
    y += current.offsetTop;
    const parent: Element | null = current.offsetParent;
    current = parent instanceof HTMLElement ? parent : null;
  }
  return { x, y };
}

export function useCommunityHeaderIdentity(
  progress: MotionValue<number>,
  getBoundary: () => HTMLDivElement | null,
  kind: "avatar" | "text"
) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const attachSource = useCallback((element: HTMLDivElement | null) => {
    sourceRef.current = element;
  }, []);
  const attachTarget = useCallback((element: HTMLDivElement | null) => {
    targetRef.current = element;
  }, []);
  const geometry = useMotionValue<HeaderIdentityGeometry>({
    sourceWidth: 0,
    sourceX: 0,
    sourceY: 0,
    targetScale: 1,
    targetWidth: 0,
    targetX: 0,
    targetY: 0,
  });
  const measure = useCallback(() => {
    const source = sourceRef.current;
    const target = targetRef.current;
    const boundary = getBoundary();
    if (!source || !target || !boundary) {
      return;
    }
    const start = layoutPosition(source, boundary);
    const end = layoutPosition(target, boundary);
    const targetScale =
      kind === "avatar"
        ? target.offsetWidth / Math.max(1, source.offsetWidth)
        : Number(getComputedStyle(target).fontSize.replace("px", "")) /
          Math.max(
            1,
            Number(getComputedStyle(source).fontSize.replace("px", ""))
          );
    geometry.set({
      sourceWidth: source.offsetWidth,
      sourceX: start.x,
      sourceY: start.y,
      targetScale,
      targetWidth: target.offsetWidth,
      targetX: end.x,
      targetY:
        end.y + (target.offsetHeight - source.offsetHeight * targetScale) / 2,
    });
  }, [getBoundary, geometry, kind]);
  const transform = useTransform(() =>
    communityIdentityTransform(geometry.get(), progress.get())
  );
  const x = useTransform(() => transform.get().x);
  const y = useTransform(() => transform.get().y);
  const scale = useTransform(() => transform.get().scale);
  const clipPath = useTransform(
    () => `inset(0px ${transform.get().clipRight}px 0px 0px)`
  );
  return {
    attachSource,
    attachTarget,
    measure,
    style: { clipPath: kind === "text" ? clipPath : undefined, scale, x, y },
  };
}
