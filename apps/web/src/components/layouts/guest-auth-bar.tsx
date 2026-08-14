"use client";

import { Button } from "@asm/ui/shadui/button";
import Link from "next/link";
import type React from "react";

// Full-width sticky bar shown to guests. On mobile it floats above the bottom
// nav (which sits at the very bottom of the screen); on larger screens it
// docks to the bottom edge.
export const GuestAuthBar: React.FC = () => (
  <div className="fixed inset-x-0 bottom-16 z-40 lg:bottom-0">
    <div className="border-t border-[hsl(var(--primary)/0.25)] bg-linear-to-r from-[#ff9500] to-[#e65500] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.4),0_-2px_8px_rgba(0,0,0,0.18)]">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-3 text-white sm:flex-row sm:gap-4">
        <div className="min-w-0 text-center sm:text-left">
          <p className="text-sm font-semibold sm:text-base">
            Log in to start posting on Asocialmedia
          </p>
          <p className="text-xs text-white/85 sm:text-sm">
            Sign in with an account to start posting on Asocialmedia
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            asChild
            className="h-9 rounded-full bg-white px-5 text-sm font-semibold text-[#e65500] shadow-[inset_0_1px_1px_rgba(255,255,255,0.6),0_1px_2px_rgba(0,0,0,0.2)] transition-all hover:bg-white/95 hover:brightness-105 active:translate-y-px"
            variant="ghost"
          >
            <Link href="/login">Log in</Link>
          </Button>
          <Button
            asChild
            className="h-9 rounded-full border border-white/60 bg-white/10 px-5 text-sm font-semibold text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.25)] backdrop-blur-sm transition-all hover:bg-white/20 active:translate-y-px"
            variant="outline"
          >
            <Link href="/signup">Sign up</Link>
          </Button>
        </div>
      </div>
    </div>
  </div>
);
