"use client";

import type { UserData } from "@asm/db";
import { Separator } from "@asm/ui/shadui/separator";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { useState } from "react";

import { APPLE_CARD_CLASS } from "@/components/home/sidebars/right/sidebar-styles";
import UserAvatar from "@/components/layouts/user-avatar";
import { FossBanner } from "@/components/misc/foss-banner";
import { useUserDataQuery } from "@/hooks/users/use-user-data-query";
import { cn, formatNumber } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

const FOOTER_LINKS = [
  { href: "/toc", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "https://x.com/parazeeknova", label: "Twitter" },
  { href: "https://github.com/asocialmedia/social", label: "Github" },
  { href: "/support", label: "Support" },
];

interface StatProps {
  label: string;
  value: number;
}

const Stat: React.FC<StatProps> = ({ label, value }) => (
  <div className="min-w-0">
    <p className="truncate font-semibold tabular-nums">{formatNumber(value)}</p>
    <p className="text-muted-foreground truncate text-xs">{label}</p>
  </div>
);

interface SettingsSidebarProps {
  user: UserData;
}

const SettingsSidebar: React.FC<SettingsSidebarProps> = ({ user }) => {
  const { data: liveUserData } = useUserDataQuery(user);
  const avatarUrl = liveUserData.avatarUrl
    ? getSecureImageUrl(liveUserData.avatarUrl)
    : null;
  const [bannerFailed, setBannerFailed] = useState(false);
  const bannerUrl =
    liveUserData.bannerUrl && !bannerFailed
      ? getSecureImageUrl(liveUserData.bannerUrl)
      : null;

  return (
    <aside className="hide-native-scrollbar bg-background border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-l px-2.5 pt-2.5 pb-6 xl:flex">
      <div className="flex flex-col gap-4">
        <div className={cn(APPLE_CARD_CLASS, "relative overflow-hidden")}>
          {/* Header image fills the card behind the identity row and stats,
              washed so the text keeps contrast - same treatment as the
              homepage "Who to follow" cards. The settings sidebar sits on the
              plain background, so the washes use --background. */}
          {bannerUrl ? (
            <>
              <div aria-hidden className="absolute inset-0">
                <Image
                  alt=""
                  className="object-cover"
                  fill
                  onError={() => setBannerFailed(true)}
                  sizes="288px"
                  src={bannerUrl}
                  unoptimized
                />
              </div>
              <div
                aria-hidden
                className="absolute inset-0 bg-linear-to-l from-[hsl(var(--background))] via-[hsl(var(--background)/0.82)] to-transparent"
              />
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--background))] via-[hsl(var(--background)/0.55)] to-transparent"
              />
              <div
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-2.5 bg-gradient-to-b from-transparent to-[hsl(var(--background))]"
              />
            </>
          ) : null}

          <div className="relative">
            <div className="flex items-center gap-3 px-2 pt-2 pb-1">
              <UserAvatar
                avatarUrl={avatarUrl}
                className="h-11 w-11"
                size={44}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {liveUserData.displayName || liveUserData.username}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  @{liveUserData.username}
                </p>
              </div>
            </div>
            <Separator className="bg-border/60 my-2" />
            <div className="grid grid-cols-3 gap-2 px-3 pb-2.5">
              <Stat label="Following" value={liveUserData._count.following} />
              <Stat label="Followers" value={liveUserData._count.followers} />
              <Stat label="Aura" value={liveUserData.aura} />
            </div>
          </div>
        </div>

        <FossBanner className="!mt-0" />

        <footer className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 px-3 pt-1 text-xs">
          <span>© {new Date().getFullYear()} asocialmedia</span>
          {FOOTER_LINKS.map(({ href, label }) => (
            <Link
              className="hover:text-foreground transition-colors"
              href={href}
              key={label}
              target={href.startsWith("http") ? "_blank" : undefined}
            >
              {label}
            </Link>
          ))}
        </footer>
      </div>
    </aside>
  );
};

export default SettingsSidebar;
