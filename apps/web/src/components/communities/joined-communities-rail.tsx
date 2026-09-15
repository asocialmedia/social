"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useSession } from "@/app/(main)/session-provider";
import { communityAccentStyle } from "@/lib/communities/accent";
import { useJoinedCommunitiesQuery } from "@/lib/communities/client";
import { cn } from "@/lib/utils";

// Joined communities rail. Sits indented under the Communities entry so the
// nav reads as one tree: a single accent tick per community, name only, no
// images or counts. Collapses to nothing when the viewer has not joined any.
export function JoinedCommunitiesRail() {
  const { user } = useSession();
  const pathname = usePathname();
  const query = useJoinedCommunitiesQuery(Boolean(user));
  const joined = query.data?.joined ?? [];

  if (!user || joined.length === 0) {
    return null;
  }

  return (
    <div className="mt-1 mb-1 flex flex-col gap-0.5 pl-4">
      {joined.slice(0, 8).map((community) => {
        const href = `/a/${community.slug}`;
        const isActive = pathname === href;
        return (
          <Link
            className={cn(
              "group flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-sm transition-colors",
              isActive
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
            href={href}
            key={community.id}
            style={communityAccentStyle(community.accentColor)}
          >
            <span
              aria-hidden="true"
              className="h-3.5 w-0.5 shrink-0 rounded-full bg-[var(--community-accent)] opacity-70 dark:bg-[var(--community-accent-dark)]"
            />
            <span className="min-w-0 truncate">{community.name}</span>
          </Link>
        );
      })}
      <Link
        className="text-muted-foreground hover:text-foreground px-3 py-1.5 pl-6 text-xs font-medium transition-colors"
        href="/comm"
      >
        Discover more
      </Link>
    </div>
  );
}
