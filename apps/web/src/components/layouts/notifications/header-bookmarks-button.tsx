"use client";

import { Bookmark } from "lucide-react";
import { usePathname } from "next/navigation";

import { HeaderIconButton } from "@/components/styles/header-buttons";

interface HeaderBookmarksButtonProps {
  count: number;
}

export default function HeaderBookmarksButton({
  count,
}: HeaderBookmarksButtonProps) {
  const pathname = usePathname();
  const isActive = pathname.startsWith("/bookmarks");

  return (
    <HeaderIconButton
      count={count}
      href="/bookmarks"
      icon={
        <>
          <Bookmark className={`h-5 w-5 ${isActive ? "text-primary" : ""}`} />
          {isActive && (
            <span className="bg-primary pointer-events-none absolute -bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full" />
          )}
        </>
      }
      title="Bookmarks"
    />
  );
}
