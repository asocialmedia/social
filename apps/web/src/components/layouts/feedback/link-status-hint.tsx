"use client";

import { useLinkStatus } from "next/link";

import { cn } from "@/lib/utils";

import Spinner3D from "./spinner-3d";

export function LinkStatusHint({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? (
    <Spinner3D className={cn("inline-block size-3.5", className)} />
  ) : null;
}
