"use client";

import { clientLog } from "@asm/config/debug";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

// React Compiler cannot lower dynamic `import()` expressions inside hooks, so
// the auth client is resolved through this plain module-scoped loader. The
// load stays lazy: it only runs when a logout actually happens.
function loadAuthClient() {
  return import("@/lib/auth").then((module) => module.authClient);
}

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
      const authClient = await loadAuthClient();
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
