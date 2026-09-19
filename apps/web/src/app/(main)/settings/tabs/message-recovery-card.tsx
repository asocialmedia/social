"use client";

import { Button } from "@asm/ui/shadui/button";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { ResetIdentityDialog } from "@/components/messages/message-identity-recovery";
import {
  SETTINGS_SUBCARD_CLASS,
  SettingsCard,
  SettingsCardHeading,
  SettingsStatusChip,
} from "@/components/settings/settings-section-card";
import { toast } from "@/lib/gooey-toast";
import {
  fetchIdentity,
  resetMessageIdentity,
  saveIdentity,
} from "@/lib/messages/client";
import type { MessageIdentityPayload } from "@/lib/messages/client";
import {
  clearStoredPrivateKey,
  getStoredAccountSecret,
  getStoredPrivateKey,
  importPrivateKeyJwk,
} from "@/lib/messages/crypto";
import {
  disableRecoveryCredential,
  enrollRecoveryCredential,
} from "@/lib/messages/recovery-client";
import { buildPasskeyBackup } from "@/lib/messages/recovery-enroll";
import { cn } from "@/lib/utils";

import { resolveRecoveryState } from "./message-recovery-state";
import type { RecoveryState } from "./message-recovery-state";

// Settings entry for the messages recovery secret.
//
// The secret is the only input that can derive the messages backup key, and it
// lives on this device alone (the server stores just a verifier hash). Two
// situations matter here:
//
//   - This device still holds the secret: let the user view and copy it, so a
//     second device (or a future reinstall) can be unlocked. This is the only
//     non-destructive way to recover an already-locked device, and before this
//     card existed the secret was never shown anywhere.
//   - This device no longer holds it: the stored backup cannot be decrypted, so
//     offer the accountable "start over" path instead of a dead end.
//
// Deliberately self-contained rather than reading MessageIdentityProvider:
// Settings is not wrapped in that provider, and the card only needs the two
// pieces of device-local state the crypto helpers expose.

export default function MessageRecoveryCard() {
  const { user } = useSession();
  const userId = user?.id;
  const [state, setState] = useState<RecoveryState>("loading");
  const [secret, setSecret] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  // Whether the server already holds a recovery credential, and whether this
  // device can enroll one (it needs the unlocked private key, which lives in
  // storage once Messages has been opened here).
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      return;
    }
    const deviceSecret = getStoredAccountSecret(userId);
    let identity: MessageIdentityPayload | null = null;
    try {
      const { identity: fetched } = await fetchIdentity();
      identity = fetched;
    } catch {
      // Treat an unreachable identity endpoint as "no identity": the card then
      // says nothing is set up rather than claiming a state we cannot verify.
      identity = null;
    }
    setSecret(deviceSecret);
    setPasskeyEnabled(Boolean(identity?.prfEncryptedPrivateKey));
    setState(
      resolveRecoveryState({
        deviceSecret,
        identityExists: identity !== null,
      })
    );
  }, [userId]);

  useEffect(() => {
    // Defer so the effect body never calls setState synchronously (the async
    // load only settles after a microtask anyway); mirrors the messages
    // identity provider's bootstrap.
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const copy = useCallback(async () => {
    if (!secret) {
      return;
    }
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast({ description: "Recovery secret copied", title: "Copied" });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the value stays selectable on screen.
    }
  }, [secret]);

  // Enroll (or re-enroll) a recovery passkey. Requires the private key on this
  // device: enrollment re-encrypts it under the credential's PRF output, so a
  // device that is itself locked has nothing to re-encrypt and must unlock
  // first (the locked state points at the locked screen for that).
  const enrollPasskey = useCallback(async () => {
    if (!userId || passkeyBusy) {
      return;
    }
    setPasskeyBusy(true);
    try {
      const stored = await getStoredPrivateKey(userId);
      if (!stored) {
        toast({
          description:
            "Open Messages on this device first, then come back to set up passkey recovery.",
          title: "Unlock Messages first",
          variant: "destructive",
        });
        return;
      }
      const { identity: current } = await fetchIdentity();
      if (!current) {
        toast({
          description: "Messages aren't set up on this account yet.",
          title: "Nothing to protect",
          variant: "destructive",
        });
        return;
      }
      const privateKey = await importPrivateKeyJwk(stored);
      const prfOutput = await enrollRecoveryCredential(userId);
      const backup = await buildPasskeyBackup({
        identity: current,
        prfOutput,
        privateKey,
      });
      await saveIdentity({
        ...backup,
        encryptedPrivateKey: current.encryptedPrivateKey,
        kdfIterations: current.kdfIterations,
        masterKeyHash: current.masterKeyHash,
        publicKey: current.publicKey,
        salt: current.salt,
      });
      setPasskeyEnabled(true);
      toast({
        description:
          "You can now unlock messages on a new device with this passkey.",
        title: "Passkey recovery on",
      });
    } catch (error) {
      toast({
        description:
          error instanceof Error
            ? error.message
            : "Couldn't set up passkey recovery",
        title: "Passkey setup failed",
        variant: "destructive",
      });
    }
    setPasskeyBusy(false);
  }, [passkeyBusy, userId]);

  const removePasskey = useCallback(async () => {
    if (passkeyBusy) {
      return;
    }
    setPasskeyBusy(true);
    try {
      await disableRecoveryCredential();
      setPasskeyEnabled(false);
      toast({
        description:
          "Your recovery secret still works. You can re-enable a passkey any time.",
        title: "Passkey recovery off",
      });
    } catch (error) {
      toast({
        description:
          error instanceof Error
            ? error.message
            : "Couldn't remove passkey recovery",
        title: "Failed",
        variant: "destructive",
      });
    }
    setPasskeyBusy(false);
  }, [passkeyBusy]);

  const confirmReset = useCallback(async () => {
    if (!userId) {
      return;
    }
    await resetMessageIdentity();
    // Drop the stale device-local material so the next messages visit
    // provisions a fresh identity and shows its new secret.
    await clearStoredPrivateKey(userId);
    setSecret(null);
    setRevealed(false);
    await load();
    toast({
      description:
        "A new messages key will be created next time you open Messages",
      title: "Messages reset",
    });
  }, [load, userId]);

  return (
    <SettingsCard className="flex min-w-0 flex-col md:col-span-2 lg:col-span-2">
      <div className="flex items-start justify-between gap-4">
        <SettingsCardHeading
          description="Restore encrypted messages on a new device"
          icon={KeyRound}
          title="Messages recovery"
        />
        {state === "loading" ? null : (
          <SettingsStatusChip on={state === "recoverable"}>
            {statusLabel(state)}
          </SettingsStatusChip>
        )}
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-3">
        {state === "loading" ? (
          <p className="text-muted-foreground text-xs">Checking…</p>
        ) : null}

        {state === "not-set-up" ? (
          <p className="text-muted-foreground text-xs">
            Messages haven&apos;t been set up on this account yet. Open Messages
            once and a recovery secret will be created for you.
          </p>
        ) : null}

        {state === "recoverable" && secret ? (
          <>
            <p className="text-muted-foreground text-xs">
              Keep this somewhere safe. It&apos;s the only way to read your
              encrypted messages on another device — we can&apos;t recover it
              for you.
            </p>
            <div
              className={cn(
                SETTINGS_SUBCARD_CLASS,
                "flex items-center gap-2 p-2.5"
              )}
            >
              <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap">
                {revealed ? secret : "•".repeat(24)}
              </code>
              <Button
                aria-label={revealed ? "Hide secret" : "Reveal secret"}
                onClick={() => setRevealed((value) => !value)}
                size="icon"
                type="button"
                variant="ghost"
              >
                {revealed ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
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
          </>
        ) : null}

        {state === "locked" ? (
          <>
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#ff9500]" />
              <p className="text-muted-foreground text-xs">
                {passkeyEnabled
                  ? "This device no longer has your messages recovery secret. Open Messages and choose \u201CUnlock with passkey\u201D to recover, or start over with a new key."
                  : "This device no longer has your messages recovery secret, so existing encrypted messages can\u2019t be unlocked here. If you saved the secret or still have another signed-in device, open Messages there to recover. Otherwise you can start over with a new key."}
              </p>
            </div>
            <Button
              className="mt-auto w-full"
              onClick={() => setResetOpen(true)}
              type="button"
              variant="outline"
            >
              Start over with a new key
            </Button>
          </>
        ) : null}
      </div>

      {state === "recoverable" ? (
        <div className="border-border/50 mt-4 border-t pt-3">
          <div className="flex items-center gap-2">
            <Fingerprint className="text-muted-foreground size-4 shrink-0" />
            <p className="text-sm font-medium">Passkey recovery</p>
            <SettingsStatusChip on={passkeyEnabled}>
              {passkeyEnabled ? "On" : "Off"}
            </SettingsStatusChip>
          </div>
          <p className="text-muted-foreground mt-1.5 text-xs">
            {passkeyEnabled
              ? "You can unlock messages on a new device with your passkey, without typing your recovery secret."
              : "Add a passkey (Face ID, Touch ID, Windows Hello) so a new device can unlock your messages without the recovery secret."}
          </p>
          <Button
            className="mt-3 w-full"
            disabled={passkeyBusy}
            onClick={() => {
              void (passkeyEnabled ? removePasskey() : enrollPasskey());
            }}
            type="button"
            variant={passkeyEnabled ? "outline" : "premium"}
          >
            {passkeyEnabled ? "Remove passkey" : "Set up passkey recovery"}
          </Button>
        </div>
      ) : null}

      <ResetIdentityDialog
        onConfirm={confirmReset}
        onOpenChange={setResetOpen}
        open={resetOpen}
      />
    </SettingsCard>
  );
}

function statusLabel(state: RecoveryState): string {
  if (state === "recoverable") {
    return "Saved";
  }
  if (state === "locked") {
    return "Locked";
  }
  return "Not set up";
}
