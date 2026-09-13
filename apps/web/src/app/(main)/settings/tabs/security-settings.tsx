"use client";

import { USERNAME_REGEX } from "@asm/auth/validation";
import type { PrivateUserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@asm/ui/shadui/form";
import { Input } from "@asm/ui/shadui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { Fingerprint, KeyRound, Mail, ShieldCheck, Trash2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import type { ControllerRenderProps } from "react-hook-form";
import { z } from "zod";

import { requestPasswordReset } from "@/app/(auth)/reset-password/server-actions";
import { LoadingButton } from "@/components/auth/loading-button";
import { PasswordInput } from "@/components/auth/password-input";
import {
  ORANGE_GRADIENT_CLASS,
  SettingsCard,
  SettingsSectionHeader,
} from "@/components/settings/settings-section-card";
import { authClient } from "@/lib/auth/auth";
import { useToast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

import { requiresFreshSession } from "./security-passkey-utils";
import SecuritySessionsCard from "./security-sessions-card";

const identifierSchema = z.object({
  identifier: z.union([
    z.email("Please enter a valid email address"),
    z
      .string()
      .regex(
        USERNAME_REGEX,
        "Username can only contain letters, numbers, and underscores"
      ),
  ]),
});

const passwordSchema = z.object({
  password: z.string().min(1, "Enter your password"),
});

const passkeyNameSchema = z.object({
  name: z.string().max(64, "Use a name shorter than 64 characters"),
});

type FormValues = z.infer<typeof identifierSchema>;
type PasswordValues = z.infer<typeof passwordSchema>;
type PasskeyNameValues = z.infer<typeof passkeyNameSchema>;

export interface SecurityPasskey {
  aaguid: string | null;
  backedUp: boolean;
  createdAt: Date | string;
  deviceType: string;
  id: string;
  name: string | null;
}

export interface SecurityState {
  hasAuthenticatorApp: boolean;
  twoFactorEnabled: boolean;
}

interface SecuritySettingsProps {
  currentSessionId: string;
  initialPasskeys: SecurityPasskey[];
  securityState: SecurityState;
  user: PrivateUserData;
}

interface TotpSetup {
  backupCodes: string[];
  uri: string;
}

function getErrorMessage(error: { message?: string } | null | undefined) {
  return error?.message || "Please try again.";
}

function getResponseErrorMessage(responseBody: unknown): string | undefined {
  if (!responseBody || typeof responseBody !== "object") {
    return undefined;
  }
  if ("message" in responseBody && typeof responseBody.message === "string") {
    return responseBody.message;
  }
  if ("error" in responseBody && typeof responseBody.error === "string") {
    return responseBody.error;
  }
  return undefined;
}

function twoFactorDialogTitle(
  action: "disable" | "email" | "totp" | null
): string {
  if (action === "disable") {
    return "Turn off two-factor authentication?";
  }
  if (action === "totp") {
    return "Add authenticator app";
  }
  return "Enable email two-factor authentication";
}

function isPasskeyRecord(value: unknown): value is SecurityPasskey {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.deviceType === "string" &&
    typeof record.backedUp === "boolean" &&
    (typeof record.createdAt === "string" ||
      record.createdAt instanceof Date) &&
    (typeof record.name === "string" || record.name === null) &&
    (typeof record.aaguid === "string" || record.aaguid === null)
  );
}

async function fetchPasskeys(): Promise<SecurityPasskey[]> {
  const response = await fetch("/api/auth/passkey/list-user-passkeys", {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Couldn’t load passkeys");
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new TypeError("Unexpected passkey response");
  }
  return data.filter(isPasskeyRecord);
}

interface PasskeyRemovalResult {
  error?: string;
  requiresReauthentication: boolean;
}

async function removePasskey(id: string): Promise<PasskeyRemovalResult> {
  try {
    const response = await fetch("/api/auth/passkey/delete-passkey", {
      body: JSON.stringify({ id }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (response.ok) {
      return { requiresReauthentication: false };
    }
    const responseBody: unknown = await response.json().catch(() => null);
    return {
      error: "Couldn’t remove this passkey. Re-authenticate and try again.",
      requiresReauthentication: requiresFreshSession({
        message: getResponseErrorMessage(responseBody),
        status: response.status,
      }),
    };
  } catch {
    return {
      error: "Couldn’t remove this passkey. Please try again.",
      requiresReauthentication: false,
    };
  }
}

type PendingPasskeyAction =
  | { id: string; type: "remove" }
  | { name: string; type: "add" };

export default function SecuritySettings({
  currentSessionId,
  initialPasskeys,
  securityState,
  user,
}: SecuritySettingsProps) {
  const [isPending, startTransition] = useTransition();
  const [isEmailSent, setIsEmailSent] = useState(false);
  const [isTwoFactorEnabled, setIsTwoFactorEnabled] = useState(
    securityState.twoFactorEnabled
  );
  const [hasAuthenticatorApp, setHasAuthenticatorApp] = useState(
    securityState.hasAuthenticatorApp
  );
  const [passkeys, setPasskeys] = useState(initialPasskeys);
  const [twoFactorAction, setTwoFactorAction] = useState<
    "disable" | "email" | "totp" | null
  >(null);
  const [totpSetup, setTotpSetup] = useState<TotpSetup | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [isTotpVerificationPending, setIsTotpVerificationPending] =
    useState(false);
  const [isPasskeyDialogOpen, setIsPasskeyDialogOpen] = useState(false);
  const [isPasskeyPending, setIsPasskeyPending] = useState(false);
  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(
    null
  );
  const [pendingPasskeyAction, setPendingPasskeyAction] =
    useState<PendingPasskeyAction | null>(null);
  const [isPasskeyReauthenticationOpen, setIsPasskeyReauthenticationOpen] =
    useState(false);
  const [
    isPasskeyReauthenticationPending,
    setIsPasskeyReauthenticationPending,
  ] = useState(false);
  const { toast } = useToast();

  const form = useForm<FormValues>({
    defaultValues: {
      identifier: user.email || user.username || "",
    },
    resolver: zodResolver(identifierSchema),
  });
  const passwordForm = useForm<PasswordValues>({
    defaultValues: { password: "" },
    resolver: zodResolver(passwordSchema),
  });
  const passkeyReauthenticationForm = useForm<PasswordValues>({
    defaultValues: { password: "" },
    resolver: zodResolver(passwordSchema),
  });
  const passkeyNameForm = useForm<PasskeyNameValues>({
    defaultValues: { name: "" },
    resolver: zodResolver(passkeyNameSchema),
  });

  const renderIdentifierField = useCallback(
    ({ field }: { field: ControllerRenderProps<FormValues, "identifier"> }) => (
      <FormItem>
        <FormLabel>Username or Email</FormLabel>
        <FormControl>
          <Input
            className="premium-input h-10 rounded-xl text-sm"
            disabled={isEmailSent}
            placeholder="Enter your username or email to reset password"
            type="text"
            {...field}
          />
        </FormControl>
        <FormMessage />
      </FormItem>
    ),
    [isEmailSent]
  );

  function onPasswordResetSubmit(values: FormValues) {
    startTransition(async () => {
      const result = await requestPasswordReset(values);

      if (result.error) {
        toast({
          description: result.error,
          title: "Couldn’t Send",
          variant: "destructive",
        });
        return;
      }

      setIsEmailSent(true);
      toast({
        description: "Check your inbox for the reset link",
        title: "Email Sent",
      });
    });
  }

  async function submitTwoFactorAction(values: PasswordValues) {
    if (!twoFactorAction) {
      return;
    }

    if (twoFactorAction === "disable") {
      const result = await authClient.twoFactor.disable({
        password: values.password,
      });
      if (result.error) {
        toast({
          description: getErrorMessage(result.error),
          title: "Couldn’t disable two-factor authentication",
          variant: "destructive",
        });
        return;
      }
      setHasAuthenticatorApp(false);
      setIsTwoFactorEnabled(false);
      setTwoFactorAction(null);
      passwordForm.reset();
      toast({
        description: "Your account no longer requires a second factor.",
        title: "Two-factor authentication disabled",
      });
      return;
    }

    if (twoFactorAction === "email") {
      if (!user.email || !user.emailVerified) {
        toast({
          description:
            "Add and verify an email address before using email 2FA.",
          title: "Verified email required",
          variant: "destructive",
        });
        return;
      }
      const result = await authClient.twoFactor.enable({
        method: "otp",
        password: values.password,
      });
      if (result.error) {
        toast({
          description: getErrorMessage(result.error),
          title: "Couldn’t enable email two-factor authentication",
          variant: "destructive",
        });
        return;
      }
      setIsTwoFactorEnabled(true);
      setTwoFactorAction(null);
      passwordForm.reset();
      toast({
        description:
          "We’ll send a code to your verified email whenever it’s needed.",
        title: "Email two-factor authentication enabled",
      });
      return;
    }

    const result = await authClient.twoFactor.enable({
      method: "totp",
      password: values.password,
    });
    if (result.error || !result.data || result.data.method !== "totp") {
      toast({
        description: getErrorMessage(result.error),
        title: "Couldn’t start authenticator setup",
        variant: "destructive",
      });
      return;
    }
    setTotpSetup({
      backupCodes: result.data.backupCodes,
      uri: result.data.totpURI,
    });
    setTwoFactorAction(null);
    passwordForm.reset();
  }

  async function verifyAuthenticatorCode() {
    if (!totpSetup || !totpCode.trim()) {
      return;
    }
    setIsTotpVerificationPending(true);
    const result = await authClient.twoFactor.verifyTotp({
      code: totpCode.trim(),
    });
    setIsTotpVerificationPending(false);
    if (result.error) {
      toast({
        description: getErrorMessage(result.error),
        title: "Authenticator code wasn’t accepted",
        variant: "destructive",
      });
      return;
    }
    setHasAuthenticatorApp(true);
    setIsTwoFactorEnabled(true);
    setTotpCode("");
  }

  async function refreshPasskeys() {
    try {
      setPasskeys(await fetchPasskeys());
    } catch (error) {
      toast({
        description:
          error instanceof Error
            ? error.message
            : "Please reload and try again.",
        title: "Couldn’t refresh passkeys",
        variant: "destructive",
      });
    }
  }

  function requestPasskeyReauthentication(action: PendingPasskeyAction) {
    setPendingPasskeyAction(action);
    setIsPasskeyDialogOpen(false);
    setIsPasskeyReauthenticationOpen(true);
  }

  async function addPasskey(values: PasskeyNameValues) {
    if (!("PublicKeyCredential" in window)) {
      toast({
        description: "This browser or device does not support passkeys.",
        title: "Passkeys unavailable",
        variant: "destructive",
      });
      return;
    }
    setIsPasskeyPending(true);
    const result = await authClient.passkey.addPasskey({
      name: values.name.trim() || undefined,
    });
    setIsPasskeyPending(false);
    if (result.error) {
      if (requiresFreshSession(result.error)) {
        requestPasskeyReauthentication({
          name: values.name.trim(),
          type: "add",
        });
        return;
      }
      toast({
        description: getErrorMessage(result.error),
        title: "Couldn’t add passkey",
        variant: "destructive",
      });
      return;
    }
    setIsPasskeyDialogOpen(false);
    passkeyNameForm.reset();
    await refreshPasskeys();
    toast({
      description: "You can now use this passkey to sign in.",
      title: "Passkey added",
    });
  }

  async function deletePasskey(id: string) {
    setRemovingPasskeyId(id);
    const result = await removePasskey(id);
    if (result.requiresReauthentication) {
      setRemovingPasskeyId(null);
      requestPasskeyReauthentication({ id, type: "remove" });
      return;
    }
    if (result.error) {
      toast({
        description: result.error,
        title: "Couldn’t remove passkey",
        variant: "destructive",
      });
    } else {
      await refreshPasskeys();
      toast({ title: "Passkey removed" });
    }
    setRemovingPasskeyId(null);
  }

  function resumePendingPasskeyAction() {
    const action = pendingPasskeyAction;
    if (!action) {
      return;
    }

    setIsPasskeyReauthenticationOpen(false);
    setPendingPasskeyAction(null);
    if (action.type === "add") {
      void addPasskey({ name: action.name });
      return;
    }
    void deletePasskey(action.id);
  }

  async function confirmPasskeyReauthentication(values: PasswordValues) {
    if (!pendingPasskeyAction) {
      return;
    }

    setIsPasskeyReauthenticationPending(true);
    let isReauthenticated = false;
    try {
      const response = await fetch("/api/security/reauthenticate", {
        body: JSON.stringify(values),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (response.ok) {
        passkeyReauthenticationForm.reset();
        isReauthenticated = true;
      } else {
        const responseBody: unknown = await response.json().catch(() => null);
        const message =
          getResponseErrorMessage(responseBody) ||
          "We couldn’t confirm your password. Please try again.";
        passkeyReauthenticationForm.setError("password", { message });
      }
    } catch {
      passkeyReauthenticationForm.setError("password", {
        message: "We couldn’t confirm your password. Please try again.",
      });
    }
    setIsPasskeyReauthenticationPending(false);
    if (isReauthenticated) {
      resumePendingPasskeyAction();
    }
  }

  const twoFactorMethod = hasAuthenticatorApp
    ? "Email code and authenticator app"
    : "Email code";
  const hasRecoveryCodesToSave = hasAuthenticatorApp;

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <SettingsSectionHeader
        description="Protect access to your account and manage sign-in methods"
        icon={KeyRound}
        title="Security"
      />

      <SettingsCard className="scroll-mt-24" id="settings-two-factor">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg",
                ORANGE_GRADIENT_CLASS
              )}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
            </div>
            <div>
              <h3 className="font-medium">Two-factor authentication</h3>
              <p className="text-muted-foreground text-sm">
                {isTwoFactorEnabled ? twoFactorMethod : "Not enabled"}
              </p>
            </div>
          </div>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-semibold",
              isTwoFactorEnabled
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-muted text-muted-foreground"
            )}
          >
            {isTwoFactorEnabled ? "Protected" : "Off"}
          </span>
        </div>

        <p className="text-muted-foreground mt-4 text-sm">
          Use your verified email for security codes, then add an authenticator
          app for an additional recovery option.
        </p>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {!isTwoFactorEnabled && (
            <Button
              className="h-9 rounded-full px-4 text-sm"
              onClick={() => setTwoFactorAction("email")}
              variant="premium"
            >
              Enable email 2FA
            </Button>
          )}
          {isTwoFactorEnabled && !hasAuthenticatorApp && (
            <Button
              className="btn-3d-gray h-9 rounded-full px-4 text-sm!"
              onClick={() => setTwoFactorAction("totp")}
              variant="ghost"
            >
              Add authenticator app
            </Button>
          )}
          {isTwoFactorEnabled && (
            <Button
              className="text-destructive pill-3d-hover h-9 rounded-full px-4 text-sm"
              onClick={() => setTwoFactorAction("disable")}
              variant="ghost"
            >
              Turn off 2FA
            </Button>
          )}
        </div>
      </SettingsCard>

      <SettingsCard className="scroll-mt-24" id="settings-passkeys">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg",
                ORANGE_GRADIENT_CLASS
              )}
            >
              <Fingerprint className="h-3.5 w-3.5" />
            </div>
            <div>
              <h3 className="font-medium">Passkeys</h3>
              <p className="text-muted-foreground text-sm">
                Sign in with your device instead of a password
              </p>
            </div>
          </div>
          <Button
            className="h-9 rounded-full px-4 text-sm"
            onClick={() => setIsPasskeyDialogOpen(true)}
            variant="premium"
          >
            Add passkey
          </Button>
        </div>

        {passkeys.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">
            No passkeys added yet. Add a passkey on a device you use regularly.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {passkeys.map((passkey) => (
              <div
                className="border-border/60 flex items-center justify-between gap-3 rounded-xl border bg-[hsl(var(--background))] px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7),inset_0_1px_2px_rgba(255,255,255,0.9),inset_0_-2px_4px_rgba(0,0,0,0.03),0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_1px_2px_rgba(255,255,255,0.04),inset_0_-2px_4px_rgba(0,0,0,0.15),0_1px_3px_rgba(0,0,0,0.2)]"
                key={passkey.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {passkey.name || "Passkey"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Added {new Date(passkey.createdAt).toLocaleDateString()} ·{" "}
                    {passkey.backedUp ? "Synced" : "Device-bound"}
                  </p>
                </div>
                <LoadingButton
                  className="icon-btn-3d flex size-8 rounded-full p-0"
                  loading={removingPasskeyId === passkey.id}
                  onClick={async () => {
                    await deletePasskey(passkey.id);
                  }}
                  title="Remove passkey"
                  variant="ghost"
                >
                  <Trash2 className="size-3.5" />
                  <span className="sr-only">Remove passkey</span>
                </LoadingButton>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

      <SecuritySessionsCard currentSessionId={currentSessionId} />

      <SettingsCard className="scroll-mt-24" id="settings-password">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg",
              ORANGE_GRADIENT_CLASS
            )}
          >
            <Mail className="h-3.5 w-3.5" />
          </div>
          <div>
            <h3 className="font-medium">Change Password</h3>
            <p className="text-muted-foreground text-sm">
              We&apos;ll email you a secure reset link
            </p>
          </div>
        </div>

        <Form {...form}>
          <form
            className="mt-4 space-y-4"
            onSubmit={form.handleSubmit(onPasswordResetSubmit)}
          >
            <FormField
              control={form.control}
              name="identifier"
              render={renderIdentifierField}
            />
            <div className="flex justify-end">
              <LoadingButton
                className={cn(
                  "h-9 rounded-xl px-5",
                  ORANGE_GRADIENT_CLASS,
                  "hover:from-[#ffa629] hover:to-[#f56a14] active:translate-y-px"
                )}
                disabled={isEmailSent}
                loading={isPending}
                type="submit"
              >
                {isEmailSent ? "Email Sent" : "Send Reset Link"}
              </LoadingButton>
            </div>
          </form>
        </Form>
      </SettingsCard>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            passwordForm.reset();
            setTwoFactorAction(null);
          }
        }}
        open={twoFactorAction !== null}
      >
        <DialogContent className="apple-panel w-[calc(100%-1.5rem)] max-w-[420px] gap-0 overflow-hidden border-0 p-0 sm:rounded-2xl">
          <DialogHeader className="border-border/60 gap-0 border-b px-5 pt-5 pb-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <div className="flex size-8 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
                <ShieldCheck className="size-4" />
              </div>
              {twoFactorDialogTitle(twoFactorAction)}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-2 text-sm leading-relaxed">
              {twoFactorAction === "disable"
                ? "Enter your password to remove every second-factor method from this account."
                : "Confirm your password before changing this security setting."}
            </DialogDescription>
          </DialogHeader>
          <Form {...passwordForm}>
            <form onSubmit={passwordForm.handleSubmit(submitTwoFactorAction)}>
              <div className="px-5 py-4">
                <FormField
                  control={passwordForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current password</FormLabel>
                      <FormControl>
                        <PasswordInput
                          autoComplete="current-password"
                          placeholder="Your current password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter className="border-border/60 flex-row justify-end gap-2 border-t px-5 py-3 sm:space-x-0">
                <Button
                  className="btn-3d-gray h-9 rounded-full px-4 text-sm!"
                  onClick={() => setTwoFactorAction(null)}
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <LoadingButton
                  className="h-9 rounded-full px-4 text-sm"
                  loading={passwordForm.formState.isSubmitting}
                  type="submit"
                  variant="premium"
                >
                  Continue
                </LoadingButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !totpSetup?.backupCodes.length) {
            setTotpSetup(null);
            setTotpCode("");
          }
        }}
        open={totpSetup !== null}
      >
        <DialogContent className="apple-panel w-[calc(100%-1.5rem)] max-w-[420px] gap-0 overflow-hidden border-0 p-0 sm:rounded-2xl">
          <DialogHeader className="border-border/60 gap-0 border-b px-5 pt-5 pb-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <div className="flex size-8 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
                <KeyRound className="size-4" />
              </div>
              {hasAuthenticatorApp
                ? "Save your recovery codes"
                : "Set up your authenticator app"}
            </DialogTitle>
          </DialogHeader>
          {totpSetup && (
            <div className="space-y-4 px-5 py-4">
              {hasRecoveryCodesToSave ? (
                <>
                  <p className="text-muted-foreground text-sm">
                    These are the only copies of your recovery codes. Store them
                    in a password manager before closing this window.
                  </p>
                  <div className="border-border/60 grid grid-cols-2 gap-2 rounded-xl border bg-[hsl(var(--background))] p-3 font-mono text-sm shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7),inset_0_1px_2px_rgba(255,255,255,0.9),inset_0_-2px_4px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_1px_2px_rgba(255,255,255,0.04),inset_0_-2px_4px_rgba(0,0,0,0.15)]">
                    {totpSetup.backupCodes.map((backupCode) => (
                      <code key={backupCode}>{backupCode}</code>
                    ))}
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => {
                      setTotpSetup(null);
                      setTotpCode("");
                    }}
                    variant="premium"
                  >
                    I stored my recovery codes
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground text-sm">
                    Scan this QR code with your authenticator app, then enter
                    its six-digit code to finish setup.
                  </p>
                  <div className="border-border/60 mx-auto w-fit rounded-xl border bg-white p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7),0_1px_3px_rgba(0,0,0,0.08)]">
                    <QRCodeSVG size={184} value={totpSetup.uri} />
                  </div>
                  <Input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) => setTotpCode(event.target.value)}
                    placeholder="000000"
                    value={totpCode}
                  />
                  <LoadingButton
                    className="w-full"
                    disabled={!totpCode.trim()}
                    loading={isTotpVerificationPending}
                    onClick={verifyAuthenticatorCode}
                    type="button"
                    variant="premium"
                  >
                    Verify authenticator
                  </LoadingButton>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setIsPasskeyDialogOpen} open={isPasskeyDialogOpen}>
        <DialogContent className="apple-panel w-[calc(100%-1.5rem)] max-w-[420px] gap-0 overflow-hidden border-0 p-0 sm:rounded-2xl">
          <DialogHeader className="border-border/60 gap-0 border-b px-5 pt-5 pb-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <div className="flex size-8 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
                <Fingerprint className="size-4" />
              </div>
              Add a passkey
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Your browser will ask to save a passkey using this device or a
              nearby security key.
            </DialogDescription>
          </DialogHeader>
          <Form {...passkeyNameForm}>
            <form onSubmit={passkeyNameForm.handleSubmit(addPasskey)}>
              <div className="px-5 py-4">
                <FormField
                  control={passkeyNameForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Passkey name (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Personal laptop" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter className="border-border/60 flex-row justify-end gap-2 border-t px-5 py-3 sm:space-x-0">
                <Button
                  className="btn-3d-gray h-9 rounded-full px-4 text-sm!"
                  onClick={() => setIsPasskeyDialogOpen(false)}
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <LoadingButton
                  className="h-9 rounded-full px-4 text-sm"
                  loading={isPasskeyPending}
                  type="submit"
                  variant="premium"
                >
                  Add passkey
                </LoadingButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          setIsPasskeyReauthenticationOpen(open);
          if (!open) {
            setPendingPasskeyAction(null);
            passkeyReauthenticationForm.reset();
          }
        }}
        open={isPasskeyReauthenticationOpen}
      >
        <DialogContent className="apple-panel w-[calc(100%-1.5rem)] max-w-[420px] gap-0 overflow-hidden border-0 p-0 sm:rounded-2xl">
          <DialogHeader className="border-border/60 gap-0 border-b px-5 pt-5 pb-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <div className="flex size-8 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
                <ShieldCheck className="size-4" />
              </div>
              Confirm it&apos;s you
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Enter your password to{" "}
              {pendingPasskeyAction?.type === "add"
                ? "add a passkey"
                : "remove this passkey"}
              . This refreshes your current session in place; it does not create
              another signed-in device.
            </DialogDescription>
          </DialogHeader>
          <Form {...passkeyReauthenticationForm}>
            <form
              onSubmit={passkeyReauthenticationForm.handleSubmit(
                confirmPasskeyReauthentication
              )}
            >
              <div className="px-5 py-4">
                <FormField
                  control={passkeyReauthenticationForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current password</FormLabel>
                      <FormControl>
                        <PasswordInput
                          autoComplete="current-password"
                          placeholder="Your current password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter className="border-border/60 flex-row justify-end gap-2 border-t px-5 py-3 sm:space-x-0">
                <Button
                  className="btn-3d-gray h-9 rounded-full px-4 text-sm!"
                  onClick={() => setIsPasskeyReauthenticationOpen(false)}
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <LoadingButton
                  className="h-9 rounded-full px-4 text-sm"
                  loading={isPasskeyReauthenticationPending}
                  type="submit"
                  variant="premium"
                >
                  Confirm and continue
                </LoadingButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
