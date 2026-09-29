"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@asm/ui/shadui/alert-dialog";
import { Button } from "@asm/ui/shadui/button";
import { ShieldAlert } from "lucide-react";
import { useCallback, useState } from "react";

import { toast } from "@/lib/gooey-toast";

// Confirmation for the destructive "start over" path. Shared by the locked
// screen and the settings recovery card so the warning copy cannot drift
// between the two entries. Explains exactly what is lost (this account's old
// messages) and what is not (the other person's copy).
export function ResetIdentityDialog({
  onConfirm,
  onOpenChange,
  open,
}: {
  onConfirm: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const confirm = useCallback(async () => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : "Couldn't reset messages",
        title: "Reset failed",
        variant: "destructive",
      });
    }
    setBusy(false);
  }, [onConfirm, onOpenChange]);

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start messages over?</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;ll get a new messages key. Messages sent or received before
            this point can no longer be read on your account — they stay on the
            other person&apos;s device and are not deleted. This can&apos;t be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={busy}
            onClick={(event) => {
              // Keep the dialog mounted until the async reset resolves so the
              // busy state is visible and a failure can surface as a toast.
              event.preventDefault();
              void confirm();
            }}
          >
            {busy ? "Resetting…" : "Reset messages"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Shown when the server holds an identity this device cannot read: the row is
// corrupt, or it belongs to the abandoned verifier scheme. Recovery on a new
// device is automatic, so this is not a "provide a secret" state — the only way
// forward is an accountable reset. Mirrors the locked status from
// MessageIdentityProvider.
export function MessageIdentityLocked({
  onReset,
}: {
  onReset: () => Promise<void>;
}) {
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <div className="border-border/60 flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x">
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="panel-3d w-full max-w-sm rounded-2xl p-5">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[#ff9500]" />
            <h2 className="text-sm font-semibold">Messages can&apos;t open</h2>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            This device couldn&apos;t read your messages key. This is usually a
            stale or corrupted key. Starting over creates a new key — messages
            from before will no longer be readable to you, but they stay on the
            other person&apos;s device.
          </p>
          <Button
            className="mt-4 w-full"
            onClick={() => setResetOpen(true)}
            type="button"
            variant="premium"
          >
            Start over
          </Button>
        </div>
      </div>

      <ResetIdentityDialog
        onConfirm={onReset}
        onOpenChange={setResetOpen}
        open={resetOpen}
      />
    </div>
  );
}
