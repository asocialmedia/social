"use client";

import type { UserData } from "@asm/db";
import type React from "react";
import ContributeCard from "@/components/misc/contribution-card";
import UserDetails from "@/components/profile/sidebars/right/user-details";

interface ProfileRightSideBarProps {
  loggedInUserId: string;
  userData: UserData;
  username: string;
}

const ProfileRightSideBar: React.FC<ProfileRightSideBarProps> = ({
  userData,
  loggedInUserId,
}) => (
  <aside className="w-96 shrink-0 overflow-y-auto bg-[hsl(var(--background-alt))] p-4 text-card-foreground">
    <div className="space-y-4">
      <UserDetails loggedInUserId={loggedInUserId} userData={userData} />
      <ContributeCard isCollapsed={false} />
    </div>
  </aside>
);

export default ProfileRightSideBar;
