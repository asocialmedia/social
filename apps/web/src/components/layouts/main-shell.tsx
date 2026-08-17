"use client";

import type { UserData } from "@asm/db";
import { usePathname } from "next/navigation";
import type React from "react";

import LeftSidebar from "@/components/home/sidebars/left-side-bar";

// Media routes (/posts/[postId]/media/[index]) are standalone fullscreen pages
// and must NOT mount the app chrome (left sidebar + bounded feed column) behind
// the viewer — otherwise a direct visit flashes the post page layout first.
// Detect those paths and render the page bare, full-viewport, instead.
function isMediaRoute(pathname: string): boolean {
  return /\/posts\/[^/]+\/media\/\d+$/.test(pathname);
}

export function MainShell({
  children,
  userData,
}: {
  children: React.ReactNode;
  userData: UserData | null;
}) {
  const pathname = usePathname();
  const bare = isMediaRoute(pathname);

  if (bare) {
    return (
      <div className="relative h-dvh w-full overflow-hidden bg-black">
        {children}
      </div>
    );
  }

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={userData} />
      <div className="flex min-w-0 flex-1 items-stretch">{children}</div>
    </div>
  );
}
