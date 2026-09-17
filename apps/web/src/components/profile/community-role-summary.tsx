"use client";

import type { UserCommunityRole } from "@asm/db";
import Link from "next/link";
import type React from "react";

import CommunityRoleBadge from "@/components/communities/card/community-role-badge";
import type { CommunityBadgedRole } from "@/components/communities/card/community-role-badge";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<CommunityBadgedRole, string> = {
  MEMBER: "Member of",
  MODERATOR: "Moderator of",
  OWNER: "Owner of",
};

// Owner first, then moderator, then member: the most senior role leads.
const ROLE_ORDER: CommunityBadgedRole[] = ["OWNER", "MODERATOR", "MEMBER"];

function isBadgedRole(role: string): role is CommunityBadgedRole {
  return role === "OWNER" || role === "MODERATOR" || role === "MEMBER";
}

// How many communities to name before collapsing the tail into "+N more". Two
// reads cleanly ("a/anime & a/cosplay"); past that the line starts to wrap.
const MAX_NAMED = 2;

// Groups a user's community roles by role and renders one line per role, e.g.
// "[owner] Owner of a/anime & a/cosplay". The per-community chip version read as
// a row of unrelated tags; naming the role in a sentence is what actually tells
// a visitor what this person does around here.
const CommunityRoleSummary: React.FC<{
  className?: string;
  roles: UserCommunityRole[];
}> = ({ className, roles }) => {
  if (roles.length === 0) {
    return null;
  }

  const byRole = new Map<CommunityBadgedRole, UserCommunityRole[]>();
  for (const entry of roles) {
    if (!isBadgedRole(entry.role)) {
      continue;
    }
    const bucket = byRole.get(entry.role) ?? [];
    bucket.push(entry);
    byRole.set(entry.role, bucket);
  }

  const groups = ROLE_ORDER.flatMap((role) => {
    const entries = byRole.get(role);
    return entries && entries.length > 0 ? [{ entries, role }] : [];
  });
  if (groups.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {groups.map(({ entries, role }) => {
        const named = entries.slice(0, MAX_NAMED);
        const extra = entries.length - named.length;
        return (
          <div className="flex items-start gap-2" key={role}>
            <CommunityRoleBadge className="mt-px" roleValue={role} />
            <p className="text-muted-foreground min-w-0 text-sm leading-snug">
              {ROLE_LABEL[role]}{" "}
              {named.map((entry, index) => (
                <span key={entry.community.id}>
                  <Link
                    className="text-foreground font-medium hover:underline"
                    href={`/a/${entry.community.slug}`}
                  >
                    a/{entry.community.slug}
                  </Link>
                  {/* ", " between names, and " & " before the final one. With a
                      collapsed tail the last named entry is followed by the
                      count instead, so it takes a comma. */}
                  {index < named.length - 1 ? (
                    <span>{extra > 0 ? ", " : " & "}</span>
                  ) : null}
                </span>
              ))}
              {extra > 0 ? <span>{` & ${extra} more`}</span> : null}
            </p>
          </div>
        );
      })}
    </div>
  );
};

export default CommunityRoleSummary;
