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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void client.invalidateQueries({
          queryKey: ["discovery-suggestions", userId],
        });
      }, 800);
      void client.invalidateQueries({
        queryKey: ["network-settings", userId],
      });
    };
    const settingsChanged = () => {
      refresh();
      for (const key of [
        "explore-feed",
        "explore-top-gusts",
        "explore-gusts-grid",
        "explore-people-search",
        "explore-people",
      ]) {
        void client.invalidateQueries({ queryKey: [key] });
      }
    };
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("asm-network-settings");
    channel?.addEventListener("message", settingsChanged);
    window.addEventListener("network:settings-changed", settingsChanged);
    window.addEventListener("network:learned", refresh);
    return () => {
      clearTimeout(timer);
      channel?.close();
      window.removeEventListener("network:settings-changed", settingsChanged);
      window.removeEventListener("network:learned", refresh);
    };
  }, [client, userId]);
  return null;
}
