"use client";

import type { UserData } from "@asm/db";
import type React from "react";
import { useSession } from "@/app/(main)/session-provider";
import ProfileCard from "./right/profile-card";
import SuggestedConnections from "./right/suggested-connections";
import { TrendingTabs } from "./right/trending-tabs";

interface RightSidebarProps {
  userData: UserData;
}

const RightSidebar: React.FC<RightSidebarProps> = ({ userData }) => {
  const { user } = useSession();

  if (!(user && userData)) {
    return null;
  }

  return (
    <aside className="w-80 shrink-0 overflow-y-auto bg-[hsl(var(--background-alt))] p-4 text-card-foreground">
      <div className="space-y-4">
        <ProfileCard userData={userData} />
        <SuggestedConnections />
        <TrendingTabs />
      </div>
    </aside>
  );
};

export default RightSidebar;
