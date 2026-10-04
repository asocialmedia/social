import { GooeyToaster, gooeyToast } from "@asm/ui/native/gooey-toast";
import type { ToastButton, ToastOptions } from "@asm/ui/native/gooey-toast";
// Native counterpart of web's gooey toast (`@asm/ui/lib/gooey-toast`).
//
// The engine is the React Native port of gooey-toast@0.2.2 — the same library
// and version apps/web depends on — so both platforms get the same pill-to-body
// morph, autopilot expand/collapse, press-to-pause, swipe-to-dismiss, timeout
// bar and promise transitions. This module keeps the call-site signature the
// app already uses (and matches the web wrapper): `variant` maps onto the
// library's toast state, and `fill`/`roundness` are pinned to web's values.
//
// Web anchors bottom-right with a 16px inset; the native viewport uses the same
// position and offset so both platforms stack in the same corner.
import type { ReactNode } from "react";

// Web's dark fill, from `apps/web/src/lib/gooey-toast.ts`.
export const GOOEY_FILL = "#232323";
// Web's corner radius, from the mounted `<GooeyToaster />` options.
const GOOEY_ROUNDNESS = 12;
// Web's `--gooey-width` / `--gooey-height`, overridden in
// `apps/web/src/components/auth/shell/gooey-toast.css`.
const GOOEY_WIDTH = 280;
const GOOEY_HEIGHT = 48;

export interface ToastMessage {
  button?: ToastButton;
  description?: ReactNode;
  duration?: number;
  icon?: ReactNode;
  title?: string;
  variant?: "default" | "destructive";
}

export function toast(message: ToastMessage): void {
  const {
    button,
    description,
    duration = 5000,
    icon,
    title,
    variant,
  } = message;
  const options: ToastOptions = {
    button,
    description,
    duration,
    fill: GOOEY_FILL,
    height: GOOEY_HEIGHT,
    icon,
    roundness: GOOEY_ROUNDNESS,
    title,
    width: GOOEY_WIDTH,
  };

  // `destructive` is the app's existing spelling for the error state; the
  // library's states are the upstream ones.
  if (variant === "destructive") {
    gooeyToast.error(options);
    return;
  }
  gooeyToast.success(options);
}

export function Toaster(): ReactNode {
  return (
    <GooeyToaster offset={{ bottom: 16, right: 16 }} position="bottom-right" />
  );
}
