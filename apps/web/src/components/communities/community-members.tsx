"use client";

import { Button } from "@asm/ui/shadui/button";
import Link from "next/link";
import type React from "react";
import { useCallback, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import {
  useApproveMemberMutation,
  useSetMemberRoleMutation,
} from "@/communities/mutations";
import UserAvatar from "@/components/layouts/user-avatar";
import { useCommunityMembersQuery } from "@/lib/communities/client";
import { useToast } from "@/lib/gooey-toast";

function roleLabel(
  role: "MEMBER" | "MODERATOR" | "OWNER",
  username: string
): string {
  if (role === "OWNER") {
    return "Owner";
  }
  if (role === "MODERATOR") {
    return "Moderator";
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
    (userId: string, role: "MODERATOR" | "MEMBER") => {
      roleMutation.mutate(
        { communityId, role, userId },
        {
          onSuccess: () =>
            toast({
              description:
                role === "MODERATOR" ? "Promoted to moderator" : "Demoted",
              title: "Role updated",
            }),
        }
      );
    },
    [communityId, roleMutation, toast]
  );

  const members = membersQuery.data?.members ?? [];
  const isOwner = membersQuery.data?.membership?.role === "OWNER";

  let body: React.ReactNode;
  if (membersQuery.isLoading) {
    body = <p className="text-muted-foreground text-xs">Loading…</p>;
  } else if (members.length === 0) {
    body = (
      <p className="text-muted-foreground text-xs">
        {showPending ? "No pending requests" : "No members yet"}
      </p>
    );
  } else {
    body = (
      <ul className="flex flex-col gap-2.5">
        {members.slice(0, 12).map((member) => {
          const isSelf = member.user.id === user?.id;
          const canToggleRole = isOwner && member.role !== "OWNER" && !isSelf;
          return (
            <li className="flex items-center gap-2.5" key={member.user.id}>
              <Link href={`/users/${member.user.username}`}>
                <UserAvatar
                  avatarUrl={member.user.avatarUrl}
                  className="size-8"
                  seed={member.user.id}
                />
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  className="text-foreground block truncate text-sm font-medium hover:underline"
                  href={`/users/${member.user.username}`}
                >
                  {member.user.displayName || member.user.username}
                </Link>
                <span className="text-muted-foreground block truncate text-xs">
                  {roleLabel(member.role, member.user.username)}
                </span>
              </div>
              {showPending ? (
                <Button
                  disabled={approveMutation.isPending}
                  onClick={() => handleApprove(member.user.id)}
                  size="sm"
                  variant="outline"
                >
                  Approve
                </Button>
              ) : null}
              {!showPending && canToggleRole ? (
                <button
                  className="text-muted-foreground hover:text-foreground text-xs font-medium transition-colors"
                  onClick={() =>
                    handleRoleChange(
                      member.user.id,
                      member.role === "MODERATOR" ? "MEMBER" : "MODERATOR"
                    )
                  }
                  type="button"
                >
                  {member.role === "MODERATOR" ? "Demote" : "Promote"}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="border-border/60 rounded-2xl border p-4">
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
