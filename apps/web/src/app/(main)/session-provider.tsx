"use client";

import type React from "react";

import { FeedCacheProvider } from "@/components/feeds/feed-cache-provider";
import { NetworkSettingsSync } from "@/components/feeds/network-settings-sync";
import { SessionContext } from "@/lib/auth/session-context";
import type { SessionContextValue } from "@/lib/auth/session-context";

export { useSession } from "@/lib/auth/session-context";

export default function SessionProvider({
  children,
  value,
}: React.PropsWithChildren<{ value: SessionContextValue | null }>) {
  return (
    <SessionContext.Provider value={value}>
      <FeedCacheProvider
        key={value?.user?.id ?? "guest"}
        viewer={value?.user?.id ?? "guest"}
      >
        <NetworkSettingsSync />
        {children}
      </FeedCacheProvider>
    </SessionContext.Provider>
  );
}
