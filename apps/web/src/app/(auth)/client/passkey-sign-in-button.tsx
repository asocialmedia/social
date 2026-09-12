"use client";

import { Button } from "@asm/ui/shadui/button";
import { Fingerprint, Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth/auth";

interface PasskeySignInButtonProps {
  disabled?: boolean;
  loading?: boolean;
  onEnd?: () => void;
  onError?: (message: string) => void;
  onStart?: () => void;
}

export default function PasskeySignInButton({
  disabled,
  loading,
  onEnd,
  onError,
  onStart,
}: PasskeySignInButtonProps) {
  async function signInWithPasskey() {
    if (!("PublicKeyCredential" in window)) {
      onError?.("Passkeys are not supported by this browser or device.");
      return;
    }
    onStart?.();
    const result = await authClient.signIn.passkey().catch(() => null);
    if (!result) {
      onError?.("Couldn't sign in with a passkey. Please try again.");
      onEnd?.();
      return;
    }
    if (result.error) {
      onError?.(result.error.message || "Couldn't sign in with a passkey.");
      onEnd?.();
      return;
    }
    if (result.data) {
      window.location.assign("/");
    }
    onEnd?.();
  }

  return (
    <Button
      aria-label="Sign in with a passkey"
      className="icon-btn-3d flex size-11 shrink-0 items-center justify-center rounded-full p-0 transition-all hover:scale-105 active:scale-95"
      disabled={disabled}
      onClick={signInWithPasskey}
      title="Sign in with a passkey"
      type="button"
      variant="ghost"
    >
      {loading ? (
        <Loader2 className="size-5 animate-spin" />
      ) : (
        <Fingerprint className="size-5" />
      )}
      <span className="sr-only">Sign in with a passkey</span>
    </Button>
  );
}
