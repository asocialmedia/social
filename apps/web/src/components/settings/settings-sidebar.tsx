"use client";

import type { UserData } from "@asm/db";
import { Separator } from "@asm/ui/shadui/separator";
import Link from "next/link";
import type React from "react";

import { APPLE_CARD_CLASS } from "@/components/home/sidebars/right/sidebar-styles";
import UserAvatar from "@/components/layouts/user-avatar";
import { FossBanner } from "@/components/misc/foss-banner";
import { useUserDataQuery } from "@/hooks/use-user-data-query";
import { formatNumber } from "@/lib/utils";
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

  return (
    <aside className="hide-native-scrollbar border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-l px-5 pt-2.5 pb-6 xl:flex">
      <div className="flex flex-col gap-4">
        <div className={APPLE_CARD_CLASS}>
          <div className="flex items-center gap-3 px-2 pt-2 pb-1">
            <UserAvatar avatarUrl={avatarUrl} className="h-11 w-11" size={44} />
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
