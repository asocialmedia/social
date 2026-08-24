"use client";

import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { LogOut } from "lucide-react";
import { useState } from "react";

import { getRandomJoke } from "./constants/logout-messages";

interface LogoutDialogProps {
  onCloseAction: () => void;
  onLogoutAction: () => void | Promise<void>;
  open: boolean;
}

export const LogoutDialog = ({
  onCloseAction,
  onLogoutAction,
  open,
}: LogoutDialogProps) => {
  const [logoutJoke, setLogoutJoke] = useState(getRandomJoke());
  // Pick a fresh joke each time the dialog opens, adjusted during render
  // instead of from a cascading effect.
  const [prevOpen, setPrevOpen] = useState(open);

  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setLogoutJoke(getRandomJoke());
    }
  }

  return (
    <Dialog onOpenChange={onCloseAction} open={open}>
      <DialogContent className="apple-panel w-full max-w-[400px] gap-4 overflow-hidden p-0 sm:rounded-2xl">
        <div className="border-border/60 border-b px-5 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
              <LogOut className="h-3.5 w-3.5" />
            </div>
            Leaving so soon?
          </DialogTitle>
          <DialogDescription className="text-muted-foreground mt-1 text-xs">
            {logoutJoke}
          </DialogDescription>
        </div>

        <div className="px-5 pb-5">
          <p className="text-sm">
            You&apos;ll be signed out of your account. Come back anytime.
          </p>

          <div className="mt-5 flex justify-end gap-2">
            <Button
              className="pill-3d-hover text-muted-foreground"
              onClick={onCloseAction}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              className="rounded-full bg-gradient-to-b from-[#f87171] to-[#dc2626] px-5 py-2 text-sm text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(150,30,30,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] hover:from-[#ef4444] hover:to-[#b91c1c]"
              onClick={onLogoutAction}
            >
              Logout
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
