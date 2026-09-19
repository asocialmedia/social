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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Input } from "@asm/ui/shadui/input";
import { Check, Copy, KeyRound, ShieldAlert } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";

import { toast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

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

// Shown when the server holds an identity this device cannot unlock: the raw
// backup secret is missing (cleared storage, a different origin, a new device).
// The private key cannot be derived without it, and the server stores only a
// hash, so user input is the only path. Mirrors the locked error status from
// MessageIdentityProvider.
export function MessageIdentityLocked({
  canUsePasskey,
  onPasskeyUnlock,
  onReset,
  onUnlock,
}: {
  canUsePasskey: boolean;
  onPasskeyUnlock: () => Promise<void>;
  onReset: () => Promise<void>;
  onUnlock: (secret: string) => Promise<void>;
}) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy || secret.trim().length === 0) {
        return;
      }
      setBusy(true);
      setFormError(null);
      try {
        await onUnlock(secret);
      } catch (unlockError) {
        setFormError(
          unlockError instanceof Error
            ? unlockError.message
            : "That recovery secret didn't work"
        );
      }
      setBusy(false);
    },
    [busy, onUnlock, secret]
  );

  const handlePasskey = useCallback(async () => {
    if (passkeyBusy) {
      return;
    }
    setPasskeyBusy(true);
    setFormError(null);
    try {
      await onPasskeyUnlock();
    } catch (unlockError) {
      setFormError(
        unlockError instanceof Error
          ? unlockError.message
          : "That passkey didn't work"
      );
    }
    setPasskeyBusy(false);
  }, [onPasskeyUnlock, passkeyBusy]);

  return (
    <div className="border-border/60 flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x">
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="panel-3d w-full max-w-sm rounded-2xl p-5">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[#ff9500]" />
            <h2 className="text-sm font-semibold">Unlock your messages</h2>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            {canUsePasskey
              ? "Use the passkey you set up for messages, or enter your recovery secret."
              : "Your encrypted messages are locked to the recovery secret created when you first set up messages. If you saved that secret — or can still open your messages on another signed-in device — enter it below."}
          </p>

          {canUsePasskey ? (
            <Button
              className="mt-4 w-full"
              disabled={passkeyBusy}
              onClick={() => {
                void handlePasskey();
              }}
              type="button"
              variant="premium"
            >
              <KeyRound className="h-4 w-4" />
              {passkeyBusy ? "Waiting for passkey…" : "Unlock with passkey"}
            </Button>
          ) : null}

          <form onSubmit={handleSubmit}>
            <label
              className={cn(
                "text-muted-foreground block text-xs font-medium",
                canUsePasskey ? "mt-4" : "mt-4"
              )}
              htmlFor="message-recovery-secret"
            >
              Recovery secret
            </label>
            <Input
              autoComplete="off"
              className="mt-1.5 font-mono text-xs"
              id="message-recovery-secret"
              onChange={(event) => setSecret(event.target.value)}
              placeholder="Paste your recovery secret"
              spellCheck={false}
              value={secret}
            />

            {formError ? (
              <p className="mt-2 text-xs text-red-500">{formError}</p>
            ) : null}

            <Button
              className="mt-4 w-full"
              disabled={busy || secret.trim().length === 0}
              type="submit"
              variant={canUsePasskey ? "outline" : "premium"}
            >
              {busy ? "Unlocking…" : "Unlock messages"}
            </Button>
          </form>

          <div className="border-border/50 mt-4 border-t pt-3">
            <p className="text-muted-foreground text-[11px]">
              Don&apos;t have the secret? You can start over with a new key.
              Messages from before will no longer be readable to you.
            </p>
            <Button
              className="mt-2 w-full"
              disabled={busy || passkeyBusy}
              onClick={() => setResetOpen(true)}
              type="button"
              variant="outline"
            >
              Start over
            </Button>
          </div>
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

// One-time reveal of the backup secret generated when this device provisioned a
// fresh identity. The server keeps only the hash, so this is the user's only
// chance to store it; without it the identity is unrecoverable if local storage
// is later cleared.
export function RecoverySecretDialog({
  onClose,
  secret,
}: {
  onClose: () => void;
  secret: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast({ description: "Recovery secret copied", title: "Copied" });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the value stays selectable on screen.
    }
  }, [secret]);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
    >
      <DialogContent className="max-w-md">
        <DialogTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          Save your recovery secret
        </DialogTitle>
        <DialogDescription>
          This secret unlocks your encrypted messages on a new device. It is
          shown only once and is never stored on our servers — if you lose it
          and clear this browser, your messages can&apos;t be recovered.
        </DialogDescription>

        <div className="premium-input mt-1 flex items-center gap-2 rounded-lg p-2.5">
          <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap">
            {secret}
          </code>
          <Button
            aria-label="Copy recovery secret"
            onClick={() => {
              void copy();
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>

        <Button
          className="mt-1 w-full"
          onClick={onClose}
          type="button"
          variant="premium"
        >
          I&apos;ve saved it
        </Button>
      </DialogContent>
    </Dialog>
  );
}
