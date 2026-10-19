"use client";

import { useState } from "react";

import { useCommunityNavigationStore } from "@/store/community-navigation-store";

import { useMediaQuery } from "./use-media-query";

export function useCommunityNavigation() {
  const desktop = useMediaQuery("(min-width: 1024px)");
  const expanded = useCommunityNavigationStore((state) => state.expanded);
  const setExpanded = useCommunityNavigationStore((state) => state.setExpanded);
  const [drawerOpen, setDrawerOpen] = useState(false);
  return {
    desktop,
    open: desktop ? expanded : drawerOpen,
    setOpen: desktop ? setExpanded : setDrawerOpen,
  };
}
