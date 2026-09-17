"use client";

import { Button } from "@asm/ui/shadui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { Flame } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useCallback, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import {
  useApproveMemberMutation,
  useSetMemberRoleMutation,
} from "@/communities/mutations";
import UserAvatar from "@/components/layouts/user-avatar";
import { getAuraFlameClass } from "@/lib/aura/aura";
import { useCommunityMembersQuery } from "@/lib/communities/client";
import type {
  AssignableCommunityRole,
  CommunityRoleValue,
} from "@/lib/communities/client";
import { useToast } from "@/lib/gooey-toast";
import { cn, formatNumber } from "@/lib/utils";

import CommunityRoleBadge, {
  isCommunityBadgedRole,
} from "./community-role-badge";

function roleLabel(role: CommunityRoleValue, username: string): string {
  if (role === "OWNER") {
    return "Owner";
  }
  if (role === "MODERATOR") {
    return "Moderator";
  }
  if (role === "MEMBER") {
    return "Member";
  }
  return `@${username}`;
}

// Members module in the community sidebar. Moderators get a pending-request
// view with approve/decline; everyone else sees the active member list.
export function CommunityMembers({
  canModerate,
  communityId,
  slug,
}: {
  canModerate: boolean;
  communityId: string;
  slug: string;
}) {
  const { user } = useSession();
  const { toast } = useToast();
  const [showPending, setShowPending] = useState(false);
  const membersQuery = useCommunityMembersQuery(
    slug,
    showPending && canModerate
  );
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
  // A moderator may name members but not appoint peers; the owner manages mods.
  const canModerateRoles = isOwner || actorRole === "MODERATOR";

  let body: React.ReactNode;
  if (membersQuery.isLoading) {
    // Skeleton rows rather than a bare "Loading…" string, matching the home
    // rail's suggestion skeleton so a slow members fetch reads as a shape, not
    // as an empty card that then pops in.
    body = (
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="flex items-center gap-2.5" key={`member-sk-${index}`}>
            <div className="bg-muted size-8 shrink-0 animate-pulse rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="bg-muted h-3 w-24 animate-pulse rounded" />
              <div className="bg-muted h-2.5 w-16 animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (members.length === 0) {
    body = (
      <p className="text-muted-foreground text-xs">
        {showPending ? "No pending requests" : "No members yet"}
      </p>
    );
  } else {
    body = (
      <ul className="flex flex-col gap-1">
        {members.slice(0, 12).map((member) => {
          const isSelf = member.user.id === user?.id;
          // The owner row is never editable here: ownership transfer is out of
          // scope, and nobody promotes or demotes themselves.
          const canManage =
            canModerateRoles && member.role !== "OWNER" && !isSelf;
          // A moderator may only toggle member <-> participant; appointing a
          // moderator is the owner's alone.
          const canAppointMod = isOwner;
          const nextRole: AssignableCommunityRole =
            member.role === "PARTICIPANT" ? "MEMBER" : "PARTICIPANT";
          return (
            <li
              className="group/member hover:bg-muted/60 -mx-1 flex items-center gap-2.5 rounded-xl px-1 py-1 transition-colors"
              key={member.user.id}
            >
              <Link href={`/users/${member.user.username}`}>
                <UserAvatar
                  avatarUrl={member.user.avatarUrl}
                  className="size-8"
                  seed={member.user.id}
                />
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  className="text-foreground flex items-center gap-1.5 text-sm font-medium hover:underline"
                  href={`/users/${member.user.username}`}
                >
                  <span className="truncate">
                    {member.user.displayName || member.user.username}
                  </span>
                  {isCommunityBadgedRole(member.role) ? (
                    <CommunityRoleBadge roleValue={member.role} />
                  ) : null}
                </Link>
                <span className="text-muted-foreground block truncate text-xs">
                  {roleLabel(member.role, member.user.username)}
                </span>
              </div>
              {showPending ? (
                <Button
                  className="btn-3d-gray h-7 shrink-0 rounded-full px-2.5! py-0! text-xs!"
                  disabled={approveMutation.isPending}
                  onClick={() => handleApprove(member.user.id)}
                  size="sm"
                  variant="ghost"
                >
                  Approve
                </Button>
              ) : (
                // The member's aura, read at a glance down the column. For an
                // owner/moderator the slot is shared with the role action, which
                // swaps in on row hover so moderation never adds permanent
                // width. The swap is gated behind `(hover: hover)`: this rail
                // renders from xl up, which includes touch devices (a tablet in
                // landscape), where a hover-only control would be unreachable.
                // There the action is simply always shown.
                <span className="relative flex h-5 shrink-0 items-center justify-end">
                  <span
                    className={cn(
                      "flex items-center gap-1 text-xs",
                      canManage &&
                        "[@media(hover:hover)]:group-hover/member:hidden"
                    )}
                  >
                    <Flame
                      aria-hidden="true"
                      className={cn(
                        "size-3.5",
                        getAuraFlameClass(member.user.aura)
                      )}
                    />
                    <span className="text-foreground font-semibold tabular-nums">
                      {formatNumber(member.user.aura)}
                    </span>
                    <span className="sr-only">aura</span>
                  </span>
                  {canManage ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          aria-label={`Change role for ${member.user.username}`}
                          className="text-muted-foreground hover:text-foreground text-xs font-medium transition-colors [@media(hover:hover)]:hidden [@media(hover:hover)]:group-hover/member:block"
                          type="button"
                        >
                          Manage
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canAppointMod ? (
                          <DropdownMenuItem
                            onClick={() =>
                              handleRoleChange(
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
                            handleRoleChange(
                              member.user.id,
                              nextRole,
                              nextRole === "MEMBER"
                                ? "Promoted to member"
                                : "Moved to participant"
                            )
                          }
                        >
                          {nextRole === "MEMBER"
                            ? "Make member"
                            : "Remove member role"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="sidebar-subcard rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-foreground text-sm font-semibold">
          {showPending ? "Join requests" : "Members"}
        </h2>
        {canModerate ? (
          <button
            className="text-muted-foreground hover:text-foreground text-xs font-medium transition-colors"
            onClick={() => setShowPending((prev) => !prev)}
            type="button"
          >
            {showPending ? "View members" : "View requests"}
          </button>
        ) : null}
      </div>
      {body}
    </section>
  );
}
