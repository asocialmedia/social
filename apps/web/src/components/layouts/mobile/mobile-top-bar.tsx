"use client";

import { Button } from "@asm/ui/shadui/button";
import asmLogo from "@assets/asm.png";
import Image from "next/image";
import Link from "next/link";
import type React from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";

const MobileTopBar: React.FC = () => {
  const { user } = useSession();

  return (
    <div className="border-border/60 flex items-center gap-2 border-b px-3 py-2 md:hidden">
      <div className="flex w-10 shrink-0 items-center">
        {user ? (
          <Link className="shrink-0" href={`/users/${user.username}`}>
            <UserAvatar
              avatarUrl={user.avatarUrl ?? user.image}
              className="h-10 w-10"
              priority
            />
          </Link>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 justify-center">
        <Link className="shrink-0" href="/">
          <div className="relative h-9 w-12">
            <Image
              alt="Asocialmedia"
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
          <div aria-hidden="true" className="w-10 shrink-0" />
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
