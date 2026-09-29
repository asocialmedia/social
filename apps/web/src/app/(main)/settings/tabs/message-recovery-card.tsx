"use client";

import { Button } from "@asm/ui/shadui/button";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { ResetIdentityDialog } from "@/components/messages/message-identity-recovery";
import {
  SettingsCard,
  SettingsCardHeading,
  SettingsStatusChip,
} from "@/components/settings/settings-section-card";
import { toast } from "@/lib/gooey-toast";
import { fetchIdentity, resetMessageIdentity } from "@/lib/messages/client";
import { clearStoredPrivateKey } from "@/lib/messages/crypto";

import { resolveRecoveryState } from "./message-recovery-state";
import type { RecoveryState } from "./message-recovery-state";

// Settings entry for message encryption.
//
// Messages are encrypted with a key backed up on the server, so recovery on a
// new device is automatic: opening Messages re-derives the backup key from the
// stored identity row with nothing to type or save. This card reflects that
// state and offers the accountable "start over" path (a fresh keypair) for the
// rare case where a row can no longer be read. Deliberately self-contained
// rather than reading MessageIdentityProvider: Settings is not wrapped in that
// provider.

export default function MessageRecoveryCard() {
  const { user } = useSession();
  const userId = user?.id;
  const [state, setState] = useState<RecoveryState>("loading");
  const [resetOpen, setResetOpen] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      return;
    }
    let identityExists = false;
    try {
      const { identity } = await fetchIdentity();
      identityExists = identity !== null;
    } catch {
      // Treat an unreachable identity endpoint as "no identity": the card then
      // says nothing is set up rather than claiming a state we cannot verify.
      identityExists = false;
    }
    setState(resolveRecoveryState({ identityExists }));
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

  const confirmReset = useCallback(async () => {
    if (!userId) {
      return;
    }
    await resetMessageIdentity();
    // Drop the stale device-local key so the next messages visit provisions a
    // fresh identity.
    await clearStoredPrivateKey(userId);
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
          description="Encrypted and restored automatically on new devices"
          icon={KeyRound}
          title="Messages recovery"
        />
        {state === "loading" ? null : (
          <SettingsStatusChip on={state === "enabled"}>
            {state === "enabled" ? "Automatic" : "Not set up"}
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
            once and encryption is enabled for you.
          </p>
        ) : null}

        {state === "enabled" ? (
          <>
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <p className="text-muted-foreground text-xs">
                Your messages are encrypted, and a new device restores access
                automatically — there is nothing to save or remember.
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

      <ResetIdentityDialog
        onConfirm={confirmReset}
        onOpenChange={setResetOpen}
        open={resetOpen}
      />
    </SettingsCard>
  );
}
