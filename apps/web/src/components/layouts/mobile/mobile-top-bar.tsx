"use client";

import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";

const MobileTopBar: React.FC = () => {
  const { user } = useSession();

  return (
    <div className="flex items-center justify-between border-border/60 border-b bg-[hsl(var(--background-alt))]/90 px-4 py-2.5 backdrop-blur-md lg:hidden">
      <Link href={`/users/${user.username}`}>
        <UserAvatar avatarUrl={user.image} className="h-8 w-8" />
      </Link>

      <Link href="/">
        <Image
          alt="Asocialmedia"
          className="h-8 w-8"
          height={32}
          src="/asocialmedialogo.svg"
          width={32}
        />
      </Link>

      <div className="w-8" />
    </div>
  );
};

export default MobileTopBar;
