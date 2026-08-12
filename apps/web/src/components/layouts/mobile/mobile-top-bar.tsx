"use client";

import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { useSession } from "@/app/(main)/session-provider";
import SearchField from "@/components/layouts/search-field";
import UserAvatar from "@/components/layouts/user-avatar";

const MobileTopBar: React.FC = () => {
  const { user } = useSession();

  return (
    <div className="flex items-center gap-2 border-border/60 border-b px-3 py-2 md:hidden">
      <Link className="shrink-0" href="/">
        <div className="relative h-8 w-8">
          <Image
            alt="Asocialmedia"
            fill
            sizes="32px"
            src="/asocialmedialogo.svg"
          />
        </div>
      </Link>

      <div className="min-w-0 flex-1">
        <SearchField />
      </div>

      <Link className="shrink-0" href={`/users/${user.username}`}>
        <UserAvatar avatarUrl={user.image} className="h-10 w-10" />
      </Link>
    </div>
  );
};

export default MobileTopBar;
