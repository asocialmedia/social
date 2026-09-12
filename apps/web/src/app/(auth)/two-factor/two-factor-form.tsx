"use client";

import { Button } from "@asm/ui/shadui/button";
import { Input } from "@asm/ui/shadui/input";
import { KeyRound, Mail, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

import { LoadingButton } from "@/components/auth/loading-button";
import { authClient } from "@/lib/auth/auth";
import { useToast } from "@/lib/gooey-toast";

type VerificationMethod = "backup" | "email" | "totp";

const methodCopy: Record<VerificationMethod, string> = {
  backup: "Enter one of your unused recovery codes.",
  email: "We’ll send a one-time security code to your verified email.",
  totp: "Enter the code from your authenticator app.",
};

function errorMessage(error: { message?: string } | null): string {
  return error?.message || "That code could not be verified. Try again.";
}

export default function TwoFactorForm() {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [method, setMethod] = useState<VerificationMethod>("email");
  const [sent, setSent] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);

  async function sendEmailCode() {
    setIsPending(true);
    const result = await authClient.twoFactor.sendOtp({ trustDevice });
    setIsPending(false);

    if (result.error) {
      toast({
        description: errorMessage(result.error),
        title: "Couldn’t send code",
        variant: "destructive",
      });
      return;
    }

    setSent(true);
    toast({
      description: "Check your inbox for a six-digit security code.",
      title: "Security code sent",
    });
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      return;
    }

    setIsPending(true);
    let result;
    if (method === "email") {
      result = await authClient.twoFactor.verifyOtp({
        code: normalizedCode,
        trustDevice,
      });
    } else if (method === "totp") {
      result = await authClient.twoFactor.verifyTotp({
        code: normalizedCode,
        trustDevice,
      });
    } else {
      result = await authClient.twoFactor.verifyBackupCode({
        code: normalizedCode,
        trustDevice,
      });
    }
    setIsPending(false);

    if (result.error) {
      toast({
        description: errorMessage(result.error),
        title: "Couldn’t verify code",
        variant: "destructive",
      });
      return;
    }

    window.location.assign("/");
  }

  return (
    <div className="apple-panel w-full max-w-md overflow-hidden rounded-2xl p-0">
      <div className="border-border/60 border-b px-5 pt-5 pb-4">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
            <ShieldCheck className="size-4" />
          </div>
          <h1 className="text-base font-semibold">Verify your sign-in</h1>
        </div>
        <p className="text-muted-foreground mt-2 text-sm">
          Choose a security method to finish signing in.
        </p>
      </div>

      <form className="space-y-4 p-5" onSubmit={verifyCode}>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["email", Mail, "Email"],
              ["totp", KeyRound, "Authenticator"],
              ["backup", ShieldCheck, "Recovery"],
            ] as const
          ).map(([value, Icon, label]) => (
            <Button
              className="pill-3d-hover h-auto min-h-16 flex-col gap-1 rounded-xl px-2 py-2 text-xs"
              key={value}
              onClick={() => {
                setCode("");
                setMethod(value);
              }}
              type="button"
              variant={method === value ? "secondary" : "ghost"}
            >
              <Icon className="size-4" />
              {label}
            </Button>
          ))}
        </div>

        <p className="text-muted-foreground text-sm">{methodCopy[method]}</p>

        {method === "email" && (
          <Button
            className="btn-3d-gray h-9 w-full rounded-full px-4 text-sm!"
            disabled={isPending}
            onClick={sendEmailCode}
            type="button"
            variant="ghost"
          >
            {sent ? "Send a new code" : "Send security code"}
          </Button>
        )}

        <Input
          autoComplete="one-time-code"
          inputMode={method === "backup" ? "text" : "numeric"}
          maxLength={method === "backup" ? 64 : 6}
          onChange={(event) => setCode(event.target.value)}
          placeholder={method === "backup" ? "Recovery code" : "000000"}
          required
          value={code}
        />

        <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-sm">
          <input
            checked={trustDevice}
            className="accent-primary size-4"
            onChange={(event) => setTrustDevice(event.target.checked)}
            type="checkbox"
          />
          Trust this device for 30 days
        </label>

        <LoadingButton
          className="w-full"
          loading={isPending}
          type="submit"
          variant="premium"
        >
          Verify and sign in
        </LoadingButton>
      </form>
    </div>
  );
}
