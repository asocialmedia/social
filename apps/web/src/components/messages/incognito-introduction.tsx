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
import { Shield } from "lucide-react";

const acknowledgedAccounts = new Set<string>();

export function hasSeenIncognitoIntroduction(userId: string): boolean {
  if (acknowledgedAccounts.has(userId)) {
    return true;
  }
  try {
    return localStorage.getItem(`incognito-introduction:${userId}`) === "seen";
  } catch {
    return false;
  }
}

export function acknowledgeIncognitoIntroduction(userId: string): void {
  acknowledgedAccounts.add(userId);
  try {
    localStorage.setItem(`incognito-introduction:${userId}`, "seen");
  } catch {
    // Keep the acknowledgement in memory when browser storage is unavailable.
  }
}

export function IncognitoIntroduction({
  open,
  onAcknowledge,
}: {
  open: boolean;
  onAcknowledge: () => void;
}) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-sm"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <span className="chip-3d mb-3 flex size-11 items-center justify-center rounded-2xl">
            <Shield className="size-5" />
          </span>
          <DialogTitle>Meet incognito chat</DialogTitle>
          <DialogDescription className="pt-2 leading-relaxed">
            A separate space for temporary conversations. Each message
            disappears 24 hours after you send it. Either of you can end
            incognito to delete all its messages immediately.
          </DialogDescription>
          <p className="text-muted-foreground pt-2 text-sm leading-relaxed">
            A short note stays in your regular chat to show incognito was used.
          </p>
        </DialogHeader>
        <DialogFooter>
          <Button variant="premium" className="w-full" onClick={onAcknowledge}>
            Okay, I get it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
