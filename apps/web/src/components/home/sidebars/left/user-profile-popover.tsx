"use client";

import type { UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@asm/ui/shadui/popover";
import { formatDate } from "date-fns";
import {
  CalendarDays,
  FileText,
  Flame,
  LogOut,
  Settings2,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useCallback, useState } from "react";
import { LogoutDialog } from "@/components/layouts/logout-dialog";
import UserAvatar from "@/components/layouts/user-avatar";
import Linkify from "@/helpers/global/linkify";
import { useLogout } from "@/hooks/use-logout";
import { formatNumber } from "@/lib/utils";

interface UserProfilePopoverProps {
  userData: UserData;
}

interface PopoverStatProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}

const PopoverStat: React.FC<PopoverStatProps> = ({
  icon: Icon,
  label,
  value,
}) => (
  <div className="flex min-w-0 flex-col items-center gap-0.5">
    <Icon className="h-4 w-4 text-muted-foreground" />
    <span className="font-semibold text-sm tabular-nums">
      {formatNumber(value)}
    </span>
    <span className="truncate text-[10px] text-muted-foreground/80 uppercase tracking-wide">
      {label}
    </span>
  </div>
);

const UserProfilePopover: React.FC<UserProfilePopoverProps> = ({
  userData,
}) => {
  const {
    closeLogoutDialog,
    handleLogout,
    logoutDialogOpen,
    openLogoutDialog,
  } = useLogout();
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback((next: boolean) => setOpen(next), []);

  const handleOpenLogoutDialog = useCallback(() => {
    setOpen(false);
    openLogoutDialog();
  }, [openLogoutDialog]);

  const handleClose = useCallback(() => setOpen(false), []);

  const profileHref = `/users/${userData.username}`;

  return (
    <>
      <Popover onOpenChange={handleOpenChange} open={open}>
        <PopoverTrigger asChild>
          <button
            aria-haspopup="dialog"
            aria-label="Open your profile"
            className="pill-3d-hover group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border-0 px-2 py-2 text-left"
            type="button"
          >
            <UserAvatar avatarUrl={userData.avatarUrl} className="h-10 w-10" />
            <span className="min-w-0">
              <span className="block truncate font-medium text-sm">
                {userData.displayName || userData.username}
              </span>
              <span className="block truncate text-muted-foreground text-xs">
                @{userData.username}
              </span>
            </span>
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className="apple-panel z-50 w-[21rem] overflow-hidden rounded-2xl border-0 p-0 shadow-none"
          side="top"
          sideOffset={12}
        >
          {/* Banner */}
          <div className="relative h-24 overflow-hidden">
            {userData.avatarUrl ? (
              <div
                aria-hidden
                className="absolute inset-0 scale-110 bg-center bg-cover opacity-30 blur-md"
                style={{ backgroundImage: `url(${userData.avatarUrl})` }}
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-b from-[hsl(var(--primary)/0.45)] via-[hsl(var(--primary)/0.15)] to-[hsl(var(--background-alt))]" />
            <div className="absolute inset-x-0 bottom-0 h-px bg-border/40" />
          </div>

          {/* Avatar + identity */}
          <div className="px-4">
            <div className="relative z-10 -mt-10 flex items-end justify-between">
              <UserAvatar
                avatarUrl={userData.avatarUrl}
                className="rounded-2xl ring-4 ring-[hsl(var(--background-alt))]"
                size={72}
              />
              <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                <CalendarDays className="h-3.5 w-3.5" />
                Joined {formatDate(new Date(userData.createdAt), "MMMM yyyy")}
              </span>
            </div>

            <div className="mt-2.5">
              <h3 className="truncate font-semibold text-lg leading-tight">
                {userData.displayName || userData.username}
              </h3>
              <p className="text-muted-foreground text-sm">
                @{userData.username}
              </p>
            </div>

            {userData.bio ? (
              <Linkify>
                <p className="mt-2.5 line-clamp-3 whitespace-pre-line text-muted-foreground text-sm">
                  {userData.bio}
                </p>
              </Linkify>
            ) : null}
          </div>

          {/* Stats */}
          <div className="profile-stats-card mx-4 mt-4 grid grid-cols-4 gap-1 px-2 py-2.5">
            <PopoverStat
              icon={FileText}
              label="Posts"
              value={userData._count.posts}
            />
            <PopoverStat
              icon={Users}
              label="Followers"
              value={userData._count.followers}
            />
            <PopoverStat
              icon={UserPlus}
              label="Following"
              value={userData._count.following}
            />
            <PopoverStat icon={Flame} label="Aura" value={userData.aura} />
          </div>

          {/* Actions */}
          <div className="mt-4 flex items-center gap-2 px-4 pb-4">
            <Button
              asChild
              className="h-9 flex-1 px-4 py-2 text-sm"
              variant="premium"
            >
              <Link href={profileHref} onClick={handleClose}>
                View Profile
              </Link>
            </Button>
            <Button
              aria-label="Open settings"
              asChild
              className="icon-btn-3d h-9 w-9 shrink-0 rounded-full p-0"
              variant="ghost"
            >
              <Link href="/settings" onClick={handleClose}>
                <Settings2 className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              aria-label="Log out"
              className="icon-btn-3d icon-btn-3d-danger h-9 w-9 shrink-0 rounded-full p-0"
              onClick={handleOpenLogoutDialog}
              variant="ghost"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <LogoutDialog
        onCloseAction={closeLogoutDialog}
        onLogoutAction={handleLogout}
        open={logoutDialogOpen}
      />
    </>
  );
};

export default UserProfilePopover;
