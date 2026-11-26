"use client";

import type { CommunityData, CommunityStats } from "@asm/db";
import type { CommunityChatRoom } from "@asm/messages";
import type { RefObject } from "react";
import { createContext, useContext } from "react";

import type { useCommunityNavigation } from "@/hooks/use-community-navigation";
import type { CommunityRoleValue } from "@/lib/communities/client";

export const CommunityWorkspacePortalContext =
  createContext<HTMLDivElement | null>(null);

export interface CommunityWorkspaceData {
  community: CommunityData;
  membership: {
    role: CommunityRoleValue;
    status: "ACTIVE" | "PENDING";
  } | null;
  stats: CommunityStats;
  subscribed: boolean;
}

interface CommunityWorkspaceView extends CommunityWorkspaceData {
  channels?: CommunityChatRoom[];
  channelsUpdatedAt: number;
  globalChatHref?: string;
  navigation: ReturnType<typeof useCommunityNavigation>;
  navigationTarget: HTMLDivElement | null;
  navigationTriggerRef: RefObject<HTMLButtonElement | null>;
}

export const CommunityWorkspaceViewContext =
  createContext<CommunityWorkspaceView | null>(null);

export function useCommunityWorkspace() {
  const workspace = useContext(CommunityWorkspaceViewContext);
  if (!workspace) {
    throw new Error("Community content requires its workspace layout");
  }
  return workspace;
}
