"use client";

import { clientLog } from "@asm/config/debug";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useToast } from "@/lib/gooey-toast";

// React Compiler cannot lower dynamic `import()` expressions inside hooks, so
// the auth client is resolved through this plain module-scoped loader. The
// load stays lazy: it only runs when a logout actually happens.
function loadAuthClient() {
  return import("@/lib/auth/auth").then((module) => module.authClient);
}

export function useLogout() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);

  const openLogoutDialog = useCallback(() => setLogoutDialogOpen(true), []);

  const closeLogoutDialog = useCallback(() => setLogoutDialogOpen(false), []);

  const handleLogout = useCallback(async () => {
    setLogoutDialogOpen(false);

    try {
      const authClient = await loadAuthClient();
      const result = await authClient.signOut({
        fetchOptions: { credentials: "include" },
      });
      if (result.error) {
        clientLog.error("Sign-out error:", result.error);
        toast({
          description: "Your session is still active. Please try again.",
          title: "Couldn’t sign out",
          variant: "destructive",
        });
        setLogoutDialogOpen(true);
        return;
      }

      queryClient.clear();
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (storageError) {
        clientLog.log("Failed to clear storage:", storageError);
      }
      window.location.assign("/login");
    } catch (error) {
      clientLog.error("Sign-out error:", error);
      toast({
        description: "Your session is still active. Please try again.",
        title: "Couldn’t sign out",
        variant: "destructive",
      });
      setLogoutDialogOpen(true);
    }
  }, [queryClient, toast]);

  return {
    closeLogoutDialog,
    handleLogout,
    logoutDialogOpen,
    openLogoutDialog,
  };
}
