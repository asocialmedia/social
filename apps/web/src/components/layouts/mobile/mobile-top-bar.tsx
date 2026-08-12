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
    <div className="flex items-center gap-2 border-border/60 border-b px-3 py-2 lg:hidden">
      <Link className="shrink-0" href="/">
        <Image
          alt="Asocialmedia"
          className="h-8 w-8"
          height={32}
          src="/asocialmedialogo.svg"
          width={32}
        />
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
