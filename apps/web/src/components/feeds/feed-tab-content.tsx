"use client";

import { TabsContent } from "@asm/ui/shadui/tabs";
import { Activity, useState } from "react";
import type { ReactNode } from "react";

export function FeedTabContent({
  activeTab,
  children,
  className,
  value,
}: {
  activeTab: string;
  children: ReactNode;
  className?: string;
  value: string;
}) {
  const active = activeTab === value;
  const [visited, setVisited] = useState(active);
  if (active && !visited) {
    setVisited(true);
  }
  return (
    <TabsContent
      className={className}
      forceMount
      hidden={!active}
      value={value}
    >
      <Activity mode={active ? "visible" : "hidden"}>
        {visited || active ? children : null}
      </Activity>
    </TabsContent>
  );
}
