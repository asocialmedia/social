"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { useSession } from "@/lib/auth/session-context";

export function NetworkSettingsSync() {
  const { user } = useSession();
  const userId = user?.id;
  const client = useQueryClient();
  useNetworkSettings();
  useEffect(() => {
    if (!userId) {
      return;
    }
    const refresh = () => {
      void client.invalidateQueries({
        queryKey: ["network-settings", userId],
      });
    };
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("asm-network-settings");
    channel?.addEventListener("message", refresh);
    window.addEventListener("network:learned", refresh);
    return () => {
      channel?.close();
      window.removeEventListener("network:learned", refresh);
    };
  }, [client, userId]);
  return null;
}
