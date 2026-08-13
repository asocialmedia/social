"use client";

import { clientLog } from "@asm/config/debug";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

export function useLogout() {
  const queryClient = useQueryClient();
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);

  const openLogoutDialog = useCallback(() => setLogoutDialogOpen(true), []);

  const closeLogoutDialog = useCallback(() => setLogoutDialogOpen(false), []);

  const handleLogout = useCallback(async () => {
    setLogoutDialogOpen(false);

    queryClient.clear();

    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (error) {
      clientLog.log("Failed to clear storage:", error);
    }

    try {
      const { authClient } = await import("@/lib/auth");
      await authClient.signOut({
        fetchOptions: { credentials: "include" },
      });
    } catch {
      // Ignore; fall back to server redirect regardless
    }
    window.location.href = "/login";
  }, [queryClient]);

  return {
    closeLogoutDialog,
    handleLogout,
    logoutDialogOpen,
    openLogoutDialog,
  };
}
