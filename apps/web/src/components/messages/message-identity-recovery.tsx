"use client";

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

// Shown when the server holds an identity this device cannot unlock: the raw
// backup secret is missing (cleared storage, a different origin, a new device).
// The private key cannot be derived without it, and the server stores only a
// hash, so user input is the only path. Mirrors the locked error status from
// MessageIdentityProvider.
export function MessageIdentityLocked({
  onUnlock,
}: {
  onUnlock: (secret: string) => Promise<void>;
}) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  return (
    <div className="border-border/60 flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x">
      <div className="flex flex-1 items-center justify-center p-6">
        <form
          className="panel-3d w-full max-w-sm rounded-2xl p-5"
          onSubmit={handleSubmit}
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[#ff9500]" />
            <h2 className="text-sm font-semibold">Unlock your messages</h2>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            Your encrypted messages are locked to the recovery secret created
            when you first set up messages. If you saved that secret — or can
            still open your messages on another signed-in device — enter it
            below to unlock this one.
          </p>

          <label
            className="text-muted-foreground mt-4 block text-xs font-medium"
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
            variant="premium"
          >
            {busy ? "Unlocking…" : "Unlock messages"}
          </Button>
          <p className="text-muted-foreground mt-3 text-[11px]">
            Your secret never leaves this device. Without it, existing encrypted
            messages can&apos;t be recovered.
          </p>
        </form>
      </div>
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
