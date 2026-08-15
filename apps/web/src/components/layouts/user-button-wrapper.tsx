"use client";

import { ChevronDown } from "lucide-react";
import type React from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserButton from "@/components/layouts/user-button";
import { cn } from "@/lib/utils";

interface UserButtonWrapperProps {
  className?: string;
}

const UserButtonWrapper: React.FC<UserButtonWrapperProps> = ({ className }) => {
  const { user } = useSession();

  return (
    <UserButton
      asChild
      className={cn(
        "group border-border/50 bg-card/70 hover:bg-card/80 h-11 items-center gap-2 overflow-hidden rounded-xl border px-1 py-1.5 shadow-xs backdrop-blur-md transition-colors duration-200",
        className
      )}
    >
      {(open: boolean) => (
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 pr-2 md:flex">
            <div className="flex min-w-0 flex-col justify-center leading-tight">
              <span className="text-foreground max-w-45 truncate text-sm font-medium">
                {user?.name}
              </span>
              <span className="text-muted-foreground max-w-45 truncate text-xs">
                @{user?.username}
              </span>
            </div>
            <ChevronDown
              className={cn(
                "text-primary group-hover:text-primary/80 h-4 w-4 transition-transform duration-200",
                open ? "rotate-180" : "rotate-0"
              )}
            />
          </div>
        </div>
      )}
    </UserButton>
  );
};

export default UserButtonWrapper;
