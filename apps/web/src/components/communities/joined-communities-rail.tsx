"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useSession } from "@/app/(main)/session-provider";
import { useJoinedCommunitiesQuery } from "@/lib/communities/client";
import { cn } from "@/lib/utils";

import CommunityAvatar from "./community-avatar";

// Joined communities, nested under the Communities entry so the nav reads as
// one tree. The container is indented and each row carries the community's own
// mark (the same rounded-xl avatar shape as the rest of the app, edged in the
// community accent) with its a/<slug> address beside it. Rows reuse the parent
// nav's pill geometry and hover, so the two levels stay one system. Renders
// nothing until the viewer joins one.
export function JoinedCommunitiesRail() {
  const { user } = useSession();
  const pathname = usePathname();
  const query = useJoinedCommunitiesQuery(Boolean(user));
  const joined = query.data?.joined ?? [];

  if (!user || joined.length === 0) {
    return null;
  }

  return (
    <div className="mt-0.5 mb-1 flex flex-col gap-0.5 pl-4">
      {joined.slice(0, 8).map((community) => {
        const href = `/a/${community.slug}`;
        const isActive = pathname === href;
        return (
          <Link
            className={cn(
              "group flex w-full items-center gap-2.5 rounded-2xl border border-transparent px-3 py-1.5 text-sm transition-all duration-200 ease-out",
              isActive
                ? "pill-nav-active"
                : "pill-3d-hover text-muted-foreground hover:text-foreground"
            )}
            href={href}
            key={community.id}
          >
            <CommunityAvatar
              accentColor={community.accentColor}
              avatarUrl={community.avatarUrl}
              className="size-8"
              name={community.name}
              slug={community.slug}
            />
            <span className="min-w-0 flex-1 truncate">
              <span className="opacity-60">a/</span>
              {community.slug}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
