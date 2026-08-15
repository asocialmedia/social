"use client";

import type { UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import asmLogo from "@assets/asm.png";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserProfilePopover from "@/components/home/sidebars/left/user-profile-popover";
import UserAvatar from "@/components/layouts/user-avatar";
import { useSpotlight } from "@/components/search/spotlight-provider";
import kyInstance from "@/lib/ky";

const MobileTopBar: React.FC = () => {
  const { user } = useSession();
  const { openSpotlight } = useSpotlight();

  const { data: userData } = useQuery({
    enabled: Boolean(user),
    queryFn: () => kyInstance.get(`/api/users/${user?.id}`).json<UserData>(),
    queryKey: ["user", user?.id],
    staleTime: 1000 * 60 * 5,
  });

  const profileTrigger = () => {
    if (!user) {
      return null;
    }
    if (userData) {
      return <UserProfilePopover compact userData={userData} />;
    }
    return (
      <Link className="shrink-0" href={`/users/${user.username}`}>
        <UserAvatar
          avatarUrl={user.avatarUrl ?? user.image}
          className="h-10 w-10"
          priority
        />
      </Link>
    );
  };

  return (
    <div className="border-border/60 flex items-center gap-2 border-b px-3 py-2 md:hidden">
      <div className="flex w-10 shrink-0 items-center">{profileTrigger()}</div>

      <div className="flex min-w-0 flex-1 justify-center">
        <Link className="shrink-0" href="/">
          <div className="relative h-9 w-12">
            <Image
              alt="asocialmedia"
              className="object-contain"
              fill
              loading="eager"
              sizes="48px"
              src={asmLogo}
            />
          </div>
        </Link>
      </div>

      <div className="flex w-10 shrink-0 items-center justify-end">
        {user ? (
          <button
            aria-label="Search"
            className="rail-3d-btn flex h-10 w-10 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95"
            onClick={() => openSpotlight()}
            type="button"
          >
            <Search className="size-5" />
          </button>
        ) : (
          <Button
            asChild
            className="h-8 rounded-full px-3.5 text-xs font-semibold"
            variant="premium"
          >
            <Link href="/login">Log in</Link>
          </Button>
        )}
      </div>
    </div>
  );
};

export default MobileTopBar;
