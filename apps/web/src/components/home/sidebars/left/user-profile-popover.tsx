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
  Bookmark,
  CalendarDays,
  FileText,
  Flame,
  Globe,
  LogOut,
  Settings2,
  UserPlus,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { useCallback, useState } from "react";
import { FaGithub, FaLinkedin, FaReddit, FaXTwitter } from "react-icons/fa6";

import { LogoutDialog } from "@/components/layouts/logout-dialog";
import UserAvatar from "@/components/layouts/user-avatar";
import UserBadge from "@/components/layouts/user-badge";
import Linkify from "@/helpers/global/linkify";
import { useBookmarkCount } from "@/hooks/use-bookmark-count";
import { useLogout } from "@/hooks/use-logout";
import { getAuraFlameClass } from "@/lib/aura";
import { cn, formatNumber } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

interface UserProfilePopoverProps {
  compact?: boolean;
  userData: UserData;
}

const PopoverStat = ({
  icon: Icon,
  iconClassName,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClassName?: string;
  label: string;
  value: number;
}) => (
  <div className="flex min-w-0 flex-col items-center gap-0.5">
    <Icon className={cn("h-4 w-4", iconClassName ?? "text-muted-foreground")} />
    <span className="text-sm font-semibold tabular-nums">
      {formatNumber(value)}
    </span>
    <span className="text-muted-foreground/80 truncate text-[10px] tracking-wide uppercase">
      {label}
    </span>
  </div>
);

interface PopoverSocialLink {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

function getSocialLinks(user: UserData): PopoverSocialLink[] {
  const links: PopoverSocialLink[] = [];
  if (user.customDomain) {
    const domain = user.customDomain.replace(/^https?:\/\//, "");
    links.push({
      href: `https://${domain}`,
      icon: Globe,
      label: `Website: ${domain}`,
    });
  }
  if (user.githubUsername) {
    links.push({
      href: `https://github.com/${user.githubUsername}`,
      icon: FaGithub,
      label: `GitHub: ${user.githubUsername}`,
    });
  }
  if (user.linkedinUsername) {
    links.push({
      href: `https://www.linkedin.com/in/${user.linkedinUsername}`,
      icon: FaLinkedin,
      label: `LinkedIn: ${user.linkedinUsername}`,
    });
  }
  if (user.twitterUsername) {
    links.push({
      href: `https://x.com/${user.twitterUsername}`,
      icon: FaXTwitter,
      label: `Twitter / X: ${user.twitterUsername}`,
    });
  }
  if (user.redditUsername) {
    links.push({
      href: `https://www.reddit.com/user/${user.redditUsername}`,
      icon: FaReddit,
      label: `Reddit: ${user.redditUsername}`,
    });
  }
  return links;
}

const UserProfilePopover: React.FC<UserProfilePopoverProps> = ({
  compact = false,
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

  // Shared bookmark-count cache (posts + HN); kept live by the optimistic
  // adjustBookmarkCount updates from every toggle.
  const { data: bookmarkCountData } = useBookmarkCount();

  const profileHref = `/users/${userData.username}`;
  const socialLinks = getSocialLinks(userData);
  const hasBanner = Boolean(userData.bannerUrl);

  let bannerContent: React.ReactNode;
  if (hasBanner && userData.bannerUrl) {
    bannerContent = (
      <Image
        alt=""
        className="object-cover"
        fill
        sizes="336px"
        src={getSecureImageUrl(userData.bannerUrl)}
        unoptimized
      />
    );
  } else if (userData.avatarUrl) {
    bannerContent = (
      <div
        aria-hidden
        className="absolute inset-0 scale-110 bg-cover bg-center opacity-30 blur-md"
        style={{
          backgroundImage: `url(${getSecureImageUrl(userData.avatarUrl)})`,
        }}
      />
    );
  } else {
    bannerContent = (
      <div className="absolute inset-0 bg-gradient-to-br from-[#ff9500] via-[#e65500] to-[#8b2f00] opacity-80" />
    );
  }

  return (
    <>
      <Popover onOpenChange={handleOpenChange} open={open}>
        <PopoverTrigger asChild>
          {compact ? (
            <button
              aria-haspopup="dialog"
              aria-label={`Open profile menu for ${userData.username}`}
              className="pill-3d-hover group flex size-10 shrink-0 items-center justify-center rounded-full border-0 p-0"
              type="button"
            >
              <UserAvatar
                avatarUrl={userData.avatarUrl}
                className="size-9"
                priority
              />
            </button>
          ) : (
            <button
              aria-haspopup="dialog"
              className="pill-3d-hover group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border-0 px-2 py-2 text-left"
              type="button"
            >
              <UserAvatar
                avatarUrl={userData.avatarUrl}
                className="h-10 w-10"
                priority
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="block truncate text-sm font-medium">
                    {userData.displayName || userData.username}
                  </span>
                  <UserBadge badge={userData.badge} badges={userData.badges} />
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  @{userData.username}
                </span>
              </span>
            </button>
          )}
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className="apple-panel z-50 w-[21rem] overflow-hidden rounded-2xl border-0 p-0 shadow-none"
          side="top"
          sideOffset={12}
        >
          {/* Banner */}
          <div className="relative h-24 overflow-hidden">
            {bannerContent}
            {hasBanner ? (
              <div className="absolute inset-0 bg-gradient-to-b from-[hsl(var(--primary)/0.45)] via-[hsl(var(--primary)/0.15)] to-[hsl(var(--background-alt))]" />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--background-alt))] to-transparent" />
            )}
            <div className="bg-border/40 absolute inset-x-0 bottom-0 h-px" />
          </div>

          {/* Avatar + identity */}
          <div className="px-4">
            <div className="relative z-10 -mt-10 flex items-end justify-between">
              <UserAvatar
                avatarUrl={userData.avatarUrl}
                className="rounded-2xl ring-4 ring-[hsl(var(--background-alt))]"
                size={72}
              />
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <CalendarDays className="h-3.5 w-3.5" />
                Joined {formatDate(new Date(userData.createdAt), "MMMM yyyy")}
              </span>
            </div>

            <div className="mt-2.5">
              <h3 className="flex items-center gap-1.5 text-lg leading-tight font-semibold">
                {userData.displayName || userData.username}
                <UserBadge badge={userData.badge} />
              </h3>
              <p className="text-muted-foreground text-sm">
                @{userData.username}
              </p>
            </div>

            {userData.bio ? (
              <Linkify>
                <p className="text-muted-foreground mt-2.5 line-clamp-3 text-sm whitespace-pre-line">
                  {userData.bio}
                </p>
              </Linkify>
            ) : null}

            {socialLinks.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {socialLinks.map((link) => (
                  <a
                    aria-label={link.label}
                    className="pill-3d-hover text-muted-foreground hover:text-foreground flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-200"
                    href={link.href}
                    key={link.label}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <link.icon className="h-4 w-4" />
                  </a>
                ))}
              </div>
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
            <PopoverStat
              icon={Flame}
              iconClassName={getAuraFlameClass(userData.aura)}
              label="Aura"
              value={userData.aura}
            />
          </div>

          {/* Actions */}
          <div
            className={cn(
              "mt-4 flex items-center gap-2 px-4",
              // The mobile popover adds a Bookmarks row below (its bottom nav
              // has no room for it), so the actions row skips the padding.
              compact ? "" : "pb-4"
            )}
          >
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

          {/* Mobile-only: bookmarks lives here instead of the bottom nav. */}
          {compact ? (
            <div className="mt-3 px-4 pb-4">
              <Button
                asChild
                className="h-9 w-full px-4 py-2 text-sm"
                variant="premium"
              >
                <Link href="/bookmarks" onClick={handleClose}>
                  <Bookmark className="mr-2 h-4 w-4 shrink-0" />
                  Bookmarks
                  {bookmarkCountData && bookmarkCountData.totalCount > 0 ? (
                    <span className="ml-2 flex h-5 min-w-5 items-center justify-center rounded-full border border-white/40 bg-black/15 px-1 text-[10px] font-semibold text-white tabular-nums">
                      {formatNumber(bookmarkCountData.totalCount)}
                    </span>
                  ) : null}
                </Link>
              </Button>
            </div>
          ) : null}
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
