"use client";

import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { useEffect, useState } from "react";
import { getRandomJoke } from "./constants/logout-messages";

interface LogoutDialogProps {
  onCloseAction: () => void;
  onLogoutAction: () => void | Promise<void>;
  open: boolean;
}

export function LogoutDialog({
  onCloseAction,
  onLogoutAction,
  open,
}: LogoutDialogProps) {
  const [logoutJoke, setLogoutJoke] = useState(getRandomJoke());

  useEffect(() => {
    if (open) {
      setLogoutJoke(getRandomJoke());
    }
  }, [open]);

  return (
    <Dialog onOpenChange={onCloseAction} open={open}>
      <DialogContent className="fixed top-[50%] left-[50%] w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] rounded-2xl border border-border/50 bg-background/95 p-6 backdrop-blur-md duration-200 sm:w-full sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center font-semibold text-xl sm:text-left">
            Leaving so soon?
          </DialogTitle>
          <DialogDescription className="px-2 text-center text-base text-muted-foreground sm:px-0 sm:text-left">
            {logoutJoke}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:gap-2">
          <Button
            className="w-full sm:w-auto"
            onClick={onCloseAction}
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            className="w-full border border-red-600/20 bg-red-500/75 font-medium text-white shadow-xs backdrop-blur-md transition-all duration-200 hover:bg-red-600/90 sm:w-auto"
            onClick={onLogoutAction}
            variant="destructive"
          >
            Logout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
