"use client";

import { useLinkStatus } from "next/link";

import { cn } from "@/lib/utils";

import Spinner3D from "./spinner-3d";

// Rendered as a child of a <Link>: shows a small spinner while that link's
// navigation is pending so slow transitions give immediate feedback. Only
// mounts after the navigation is actually pending (never on instant navs),
// so it never flashes on fast route changes.
export function LinkStatusHint({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) {
    return null;
  }
  return <Spinner3D className={cn("inline-block size-3.5", className)} />;
}
