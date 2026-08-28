"use client";

import { Clock, Sparkles, Users } from "lucide-react";
import type React from "react";

import UserAvatar from "@/components/layouts/user-avatar";

export interface UserMutualFollower {
  avatarUrl: string | null;
  displayName: string;
  username: string;
}

interface UserReasonLineProps {
  mutualFollowers?: UserMutualFollower[];
  reason?: string;
}

const UserReasonLine: React.FC<UserReasonLineProps> = ({
  mutualFollowers,
  reason,
}) => {
  if (!reason) {
    return null;
  }
  return (
    <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-[11px] leading-tight">
      {mutualFollowers && mutualFollowers.length > 0 ? (
        <span className="flex shrink-0 -space-x-1.5">
          {mutualFollowers.slice(0, 3).map((m) => (
            <span
              className="ring-background rounded-full ring-2"
              key={m.username}
            >
              <UserAvatar avatarUrl={m.avatarUrl} className="h-4 w-4" />
            </span>
          ))}
        </span>
      ) : null}
      {!mutualFollowers?.length && reason.includes("Active") ? (
        <Clock className="h-3 w-3 shrink-0" />
      ) : null}
      {!mutualFollowers?.length && reason.includes("Popular") ? (
        <Sparkles className="h-3 w-3 shrink-0 fill-current" />
      ) : null}
      {!mutualFollowers?.length && reason.includes("interest") ? (
        <Users className="h-3 w-3 shrink-0" />
      ) : null}
      <span className="min-w-0">{reason}</span>
    </div>
  );
};

export default UserReasonLine;
