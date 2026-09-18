"use client";

import type { CommunityData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { Fragment, useCallback, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import {
  useApproveMemberMutation,
  useSetMemberRoleMutation,
} from "@/communities/mutations";
import RowBannerWash from "@/components/layouts/shell/row-banner-wash";
import UserAvatar from "@/components/layouts/user/user-avatar";
import { useCommunityMembersQuery } from "@/lib/communities/client";
import type {
  AssignableCommunityRole,
  CommunityMemberRow,
} from "@/lib/communities/client";
import { useToast } from "@/lib/gooey-toast";

import CommunityRoleBadge, {
  isCommunityBadgedRole,
} from "../card/community-role-badge";

// How many names the card shows before "Show more". The rest are already in
// the response (the query asks for the roster page size), so expanding is a
// client-side reveal rather than a second round trip.
const VISIBLE_LIMIT = 10;

// Order the roster by role, then join date: owner, moderators, members. The
// API already sorts this way; re-sorting here keeps the grouping correct even
// if a caller hands the component a differently-ordered page.
const ROLE_RANK: Record<string, number> = {
  MEMBER: 2,
  MODERATOR: 1,
  OWNER: 0,
  PARTICIPANT: 3,
};

function byRoleThenAge(a: CommunityMemberRow, b: CommunityMemberRow): number {
  const rank = (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9);
  if (rank !== 0) {
    return rank;
  }
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function groupLabel(role: string): string | null {
  if (role === "OWNER") {
    return "Owner";
  }
  if (role === "MODERATOR") {
    return "Moderators";
  }
  if (role === "MEMBER") {
    return "Members";
  }
  if (role === "PARTICIPANT") {
    return "Participants";
  }
  return null;
}

// One member row. The role menu only appears for someone the acting viewer may
// actually re-role, so a plain member sees a plain list.
function PersonRow({
  canAppointModerator,
  canManage,
  member,
  onApprove,
  onRoleChange,
  onSelf,
}: {
  canAppointModerator: boolean;
  canManage: boolean;
  member: CommunityMemberRow;
  onApprove: (userId: string) => void;
  onRoleChange: (
    userId: string,
    role: AssignableCommunityRole,
    message: string
  ) => void;
  onSelf: boolean;
}) {
  const isPending = member.status === "PENDING";
  const nextRole: AssignableCommunityRole =
    member.role === "PARTICIPANT" ? "MEMBER" : "PARTICIPANT";
  const nextRoleMessage =
    nextRole === "MEMBER" ? "Promoted to member" : "Moved to participant";
  const editable =
    canManage && member.role !== "OWNER" && !onSelf && !isPending;

  return (
    <li className="group/person relative overflow-hidden rounded-xl">
      {/* The member's header image washed into the row, same treatment as the
          home rail's suggestion rows. Background layer; the content below is
          relative so it sits on top. */}
      <RowBannerWash bannerUrl={member.user.bannerUrl} />
      {/* Hover tint as its own layer ABOVE the wash and BELOW the content: a
          background on the row itself would paint the banner out entirely. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-colors group-hover/person:bg-[hsl(var(--muted)/0.55)]"
      />

      <div className="relative flex items-center gap-2.5 px-2.5 py-2">
        <a className="shrink-0" href={`/users/${member.user.username}`}>
          <UserAvatar
            avatarUrl={member.user.avatarUrl}
            className="size-7"
            seed={member.user.id}
          />
        </a>

        <a
          className="min-w-0 flex-1 text-xs font-medium hover:underline"
          href={`/users/${member.user.username}`}
        >
          <span className="flex items-center gap-1.5">
            <span className="text-foreground truncate">
              {member.user.displayName || member.user.username}
            </span>
            {isCommunityBadgedRole(member.role) ? (
              <CommunityRoleBadge roleValue={member.role} />
            ) : null}
          </span>
          <span className="text-muted-foreground block truncate">
            @{member.user.username}
          </span>
        </a>

        {isPending ? (
          <Button
            className="h-6 shrink-0 rounded-full px-2.5! py-0! text-[11px]!"
            onClick={() => onApprove(member.user.id)}
            size="sm"
            variant="premium"
          >
            Approve
          </Button>
        ) : null}

        {editable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`Change role for ${member.user.username}`}
                className="text-muted-foreground hover:text-foreground shrink-0 text-[11px] font-medium transition-colors [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/person:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
                type="button"
              >
                Manage
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canAppointModerator ? (
                <DropdownMenuItem
                  onClick={() =>
                    onRoleChange(
                      member.user.id,
                      "MODERATOR",
                      "Promoted to moderator"
                    )
                  }
                >
                  Make moderator
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onClick={() =>
                  onRoleChange(member.user.id, nextRole, nextRoleMessage)
                }
              >
                {nextRole === "MEMBER" ? "Make member" : "Remove member role"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  );
}

// The community roster: who founded it, who moderates it, and who belongs.
//
// Moderation lives here rather than in a separate panel because the roster is
// already ordered by role - promoting and demoting belongs on the list that
// shows the roles. Join requests button appears only where they exist, which
// is restricted and private communities; a public community approves everyone
// on join, so there is nothing to review.
export function CommunityPeople({
  canModerate,
  communityId,
  communityType,
  slug,
}: {
  canModerate: boolean;
  communityId: string;
  communityType: CommunityData["type"];
  slug: string;
}) {
  const { user } = useSession();
  const { toast } = useToast();
  const [showAll, setShowAll] = useState(false);
  const [showPending, setShowPending] = useState(false);

  // Public communities never hold pending members, so the requests view is
  // offered only where approval actually gates entry.
  const supportsJoinRequests = communityType !== "PUBLIC";
  const viewingRequests = showPending && canModerate && supportsJoinRequests;

  const membersQuery = useCommunityMembersQuery(slug, {
    // Moderators see the FULL roster, including plain participants, so a new
    // joiner is visible to the owner the moment they join. Everyone else gets
    // only badged roles: participants are the default state, so listing every
    // joiner would bury the people who actually hold a role.
    badged: !canModerate,
    // The roster page size, so "Show more" reveals what is already loaded.
    limit: 50,
    // Pending and active are separate lists; the route ignores pending unless
    // the caller can moderate.
    pending: viewingRequests,
  });
  const approveMutation = useApproveMemberMutation(slug);
  const roleMutation = useSetMemberRoleMutation(slug);

  const handleApprove = useCallback(
    (userId: string) => {
      approveMutation.mutate(
        { communityId, userId },
        {
          onSuccess: () =>
            toast({ description: "Member approved", title: "Approved" }),
        }
      );
    },
    [approveMutation, communityId, toast]
  );

  const handleRoleChange = useCallback(
    (userId: string, role: AssignableCommunityRole, message: string) => {
      roleMutation.mutate(
        { communityId, role, userId },
        {
          onSuccess: () =>
            toast({ description: message, title: "Role updated" }),
        }
      );
    },
    [communityId, roleMutation, toast]
  );

  const members = membersQuery.data?.members ?? [];
  const actorRole = membersQuery.data?.membership?.role;
  const isOwner = actorRole === "OWNER";
  const canManageRoles = canModerate;

  const ordered = viewingRequests
    ? members
    : [...members].toSorted(byRoleThenAge);
  const visible = showAll ? ordered : ordered.slice(0, VISIBLE_LIMIT);
  const hiddenCount = ordered.length - visible.length;

  let body: React.ReactNode;
  if (membersQuery.isLoading) {
    body = (
      <div className="flex flex-col gap-2 px-1.5 py-1">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="flex items-center gap-2.5" key={`person-sk-${index}`}>
            <div className="bg-muted size-7 shrink-0 animate-pulse rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="bg-muted h-3 w-24 animate-pulse rounded" />
              <div className="bg-muted h-2.5 w-16 animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (ordered.length === 0) {
    body = (
      <p className="text-muted-foreground px-1.5 py-1 text-xs">
        {viewingRequests ? "No pending requests" : "No members yet"}
      </p>
    );
  } else {
    body = (
      <ul className="flex flex-col gap-0.5">
        {visible.map((member, index) => {
          const label = viewingRequests ? null : groupLabel(member.role);
          const previous = index > 0 ? visible[index - 1] : undefined;
          const showGroupLabel =
            label !== null &&
            (!previous || groupLabel(previous.role) !== label);
          return (
            <Fragment key={member.user.id}>
              {showGroupLabel ? (
                <li className="text-muted-foreground px-1.5 pt-2 pb-0.5 text-[10px] font-semibold tracking-wide uppercase">
                  {label}
                </li>
              ) : null}
              <PersonRow
                canAppointModerator={isOwner}
                canManage={canManageRoles}
                member={member}
                onApprove={handleApprove}
                onRoleChange={handleRoleChange}
                onSelf={member.user.id === user?.id}
              />
            </Fragment>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="sidebar-subcard rounded-2xl p-2">
      <div className="flex items-center gap-2 px-1.5 pt-1.5 pb-1">
        <h2 className="text-foreground flex-1 text-sm font-semibold">
          {viewingRequests ? "Join requests" : "People"}
        </h2>
        {canModerate && supportsJoinRequests ? (
          <button
            className="text-muted-foreground hover:text-foreground text-[11px] font-medium transition-colors"
            onClick={() => setShowPending((prev) => !prev)}
            type="button"
          >
            {viewingRequests ? "View people" : "Requests"}
          </button>
        ) : null}
      </div>

      {body}

      {!viewingRequests && hiddenCount > 0 ? (
        <button
          className="text-muted-foreground hover:text-foreground mt-0.5 w-full px-1.5 py-1.5 text-left text-[11px] font-medium transition-colors hover:underline"
          onClick={() => setShowAll(true)}
          type="button"
        >
          Show more ({hiddenCount})
        </button>
      ) : null}
    </section>
  );
}
