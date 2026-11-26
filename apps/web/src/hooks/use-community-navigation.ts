"use client";

import { useCallback, useMemo, useState } from "react";

import { useCommunityNavigationStore } from "@/store/community-navigation-store";

import { useMediaQuery } from "./use-media-query";

export function useCommunityNavigation(section: "chat" | "posts") {
  const desktop = useMediaQuery("(min-width: 1280px)");
  const expanded = useCommunityNavigationStore((state) => state.expanded);
  const setExpanded = useCommunityNavigationStore((state) => state.setExpanded);
  const [drawerSection, setDrawerSection] = useState<"chat" | "posts" | null>(
    null
  );
  if (drawerSection && drawerSection !== section) {
    setDrawerSection(null);
  }
  const setDrawerOpen = useCallback(
    (open: boolean) => {
      setDrawerSection(open ? section : null);
    },
    [section]
  );
  return useMemo(
    () => ({
      desktop,
      open: desktop ? expanded : drawerSection === section,
      setOpen: desktop ? setExpanded : setDrawerOpen,
    }),
    [desktop, drawerSection, expanded, section, setDrawerOpen, setExpanded]
  );
}
