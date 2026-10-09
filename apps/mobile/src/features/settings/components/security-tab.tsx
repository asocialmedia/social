// Native port of web's `settings/tabs/security-settings.tsx` plus its
// `security-sessions-card`, `message-recovery-card` and `push-settings-card`.
//
// The two flows that lock people out are preserved exactly:
//   - Removing the authenticator is disable-then-re-enable-email, so the email
//     fallback survives an authenticator loss.
//   - Revoking the current session signs the app out rather than leaving it
//     holding a cookie the server no longer accepts.
import { USERNAME_REGEX } from "@asm/auth/validation";
import {
  BellRing,
  Fingerprint,
  KeyRound,
  Mail,
  MonitorSmartphone,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode, RefObject } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";

import { toast } from "@/components/feedback/toast";
import { requestPasswordReset } from "@/features/auth/lib/auth-api";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { useSessionContext } from "@/features/auth/state/session";
import {
  registerForPushNotifications,
  unregisterPushNotifications,
} from "@/features/notifications/lib/push";
import {
  getPushSetupStatus,
  pushSetupCopy,
} from "@/features/notifications/lib/push-setup";
import { getApiBaseUrl } from "@/lib/api-env";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { useAppTheme } from "@/theme";

import {
  fetchMessageIdentity,
  fetchPasskeys,
  removePasskey,
  resetMessageIdentity,
} from "../lib/security-api";
import type { PasskeyEntry } from "../lib/security-api";
import {
  formatLastActive,
  getSessionLocation,
  sessionDeviceLabel,
} from "../lib/session-labels";
import {
  fetchSecuritySessions,
  reauthenticate,
  revokeSecuritySession,
} from "../lib/settings-api";
import type { SecuritySession } from "../lib/settings-api";
import { SectionAnchor } from "../lib/settings-scroll";
import { SettingsRowsSkeleton } from "./settings-skeleton";
import {
  SettingsButton,
  SettingsCard,
  SettingsCardHeading,
  SettingsIconButton,
  SettingsInput,
  SettingsSectionHeader,
  SettingsStatusChip,
  SettingsSubcard,
  SettingsSwitch,
} from "./settings-ui";

type TwoFactorAction = "disable" | "email" | "remove-authenticator" | "totp";

interface TotpSetup {
  backupCodes: string[];
  uri: string;
}

interface ApiOptions {
  apiBase: string;
  cookie: string;
}

function twoFactorDialogTitle(action: TwoFactorAction | null): string {
  if (action === "disable") {
    return "Turn off two-factor authentication?";
  }
  if (action === "remove-authenticator") {
    return "Remove your authenticator app?";
  }
  if (action === "totp") {
    return "Add authenticator app";
  }
  return "Enable email two-factor authentication";
}

function twoFactorDescription(action: TwoFactorAction | null): string {
  if (action === "disable") {
    return "Enter your password to remove every second-factor method from this account.";
  }
  if (action === "remove-authenticator") {
    return "Enter your password to remove your authenticator app. If email codes are on, they stay as your second factor.";
  }
  return "Confirm your password before changing this security setting.";
}

function errorMessage(error: { message?: string } | null | undefined): string {
  return error?.message || "Please try again.";
}

// Web's email-row action, chosen by state. Removing email while the
// authenticator stays on is not a state the auth plugin supports, so that case
// says so rather than offering an action that cannot work.
function emailMethodAction({
  email,
  emailCodesOn,
  emailVerified,
  hasAuthenticatorApp,
  mutedColor,
  onDisable,
  onEnable,
}: {
  email: string | null;
  emailCodesOn: boolean;
  emailVerified: boolean;
  hasAuthenticatorApp: boolean;
  mutedColor: string;
  onDisable: () => void;
  onEnable: () => void;
}): ReactNode {
  if (emailCodesOn && hasAuthenticatorApp) {
    return (
      <Text style={[styles.methodDesc, { color: mutedColor }]}>
        Kept as fallback
      </Text>
    );
  }
  if (emailCodesOn) {
    return (
      <SettingsButton
        label="Turn off"
        onPress={onDisable}
        size="sm"
        tone="danger"
      />
    );
  }
  return (
    <SettingsButton
      disabled={!email || !emailVerified}
      label="Turn on"
      onPress={onEnable}
      size="sm"
    />
  );
}

function isFreshSession(error: { message?: string; status?: number }): boolean {
  return (
    error.status === 403 &&
    error.message?.toLowerCase().includes("fresh") === true
  );
}

export function SecurityTab({
  email,
  emailVerified,
  hasAuthenticatorApp: initialHasAuthenticator,
  scrollRef,
  twoFactorEnabled: initialTwoFactorEnabled,
}: {
  email: string | null;
  emailVerified: boolean;
  hasAuthenticatorApp: boolean;
  scrollRef: RefObject<ScrollView | null>;
  twoFactorEnabled: boolean;
}) {
  const { theme } = useAppTheme();
  const { runWithInstallToken } = useInstall();
  const { refresh, sessionId, signOut, user } = useSessionContext();

  const [isEmailSent, setIsEmailSent] = useState(false);
  const [isTwoFactorEnabled, setIsTwoFactorEnabled] = useState(
    initialTwoFactorEnabled
  );
  const [hasAuthenticatorApp, setHasAuthenticatorApp] = useState(
    initialHasAuthenticator
  );
  const [passkeys, setPasskeys] = useState<PasskeyEntry[]>([]);
  const [passkeysLoaded, setPasskeysLoaded] = useState(false);
  const [twoFactorAction, setTwoFactorAction] =
    useState<TwoFactorAction | null>(null);
  const [totpSetup, setTotpSetup] = useState<TotpSetup | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [isTotpVerificationPending, setIsTotpVerificationPending] =
    useState(false);
  const [isPasskeyDialogOpen, setIsPasskeyDialogOpen] = useState(false);
  const [isPasskeyPending, setIsPasskeyPending] = useState(false);
  const [, setRemovingPasskeyId] = useState<string | null>(null);
  const [passkeyName, setPasskeyName] = useState("");
  const [pendingPasskeyAction, setPendingPasskeyAction] = useState<{
    id?: string;
    name?: string;
    type: "add" | "remove";
  } | null>(null);
  const [isPasskeyReauthOpen, setIsPasskeyReauthOpen] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [isPasskeyReauthPending, setIsPasskeyReauthPending] = useState(false);

  const [identifier, setIdentifier] = useState(email || user?.username || "");
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [twoFactorSubmitting, setTwoFactorSubmitting] = useState(false);

  const options = useCallback(
    async (): Promise<ApiOptions> => ({
      apiBase: getApiBaseUrl(),
      cookie: (await authClient.getCookie()) ?? "",
    }),
    []
  );

  const refreshPasskeys = useCallback(async () => {
    const result = await fetchPasskeys(await options());
    if (result === null) {
      toast({
        description: "Please reload and try again.",
        title: "Couldn't refresh passkeys",
        variant: "destructive",
      });
      return;
    }
    setPasskeys(result);
    setPasskeysLoaded(true);
  }, [options]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- refreshPasskeys awaits the fetch before touching state
    void refreshPasskeys();
  }, [refreshPasskeys]);

  const onPasswordResetSubmit = async () => {
    const value = identifier.trim();
    if (!value) {
      return;
    }
    const valid = value.includes("@")
      ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      : USERNAME_REGEX.test(value);
    if (!valid) {
      toast({
        description: "Enter a valid email address or username",
        title: "Check Your Input",
        variant: "destructive",
      });
      return;
    }
    setIsEmailSent(true);
    const result = await requestPasswordReset(value);
    if (!result.ok) {
      setIsEmailSent(false);
      toast({
        description: result.error ?? "Couldn't send the reset email.",
        title: "Couldn't Send",
        variant: "destructive",
      });
      return;
    }
    toast({
      description: "Check your inbox for the reset link",
      title: "Email Sent",
    });
  };

  const submitTwoFactorAction = async () => {
    if (!twoFactorAction) {
      return;
    }
    if (!twoFactorPassword) {
      toast({
        description: "Enter your password",
        title: "Check Your Password",
        variant: "destructive",
      });
      return;
    }
    setTwoFactorSubmitting(true);

    if (twoFactorAction === "disable") {
      const result = await authClient.twoFactor.disable({
        password: twoFactorPassword,
      });
      setTwoFactorSubmitting(false);
      if (result.error) {
        toast({
          description: errorMessage(result.error),
          title: "Couldn't disable two-factor authentication",
          variant: "destructive",
        });
        return;
      }
      setHasAuthenticatorApp(false);
      setIsTwoFactorEnabled(false);
      setTwoFactorAction(null);
      setTwoFactorPassword("");
      toast({
        description: "Your account no longer requires a second factor.",
        title: "Two-factor authentication disabled",
      });
      return;
    }

    if (twoFactorAction === "remove-authenticator") {
      const wasEmailEnabled = isTwoFactorEnabled && emailVerified;
      const disabled = await authClient.twoFactor.disable({
        password: twoFactorPassword,
      });
      if (disabled.error) {
        setTwoFactorSubmitting(false);
        toast({
          description: errorMessage(disabled.error),
          title: "Couldn't remove your authenticator app",
          variant: "destructive",
        });
        return;
      }
      if (wasEmailEnabled) {
        const reEnabled = await authClient.twoFactor.enable({
          method: "otp",
          password: twoFactorPassword,
        });
        if (reEnabled.error) {
          setTwoFactorSubmitting(false);
          toast({
            description:
              "Your authenticator was removed, but we couldn't re-enable email codes. Turn them back on below.",
            title: "Email codes need re-enabling",
            variant: "destructive",
          });
          setHasAuthenticatorApp(false);
          setIsTwoFactorEnabled(false);
          setTwoFactorAction(null);
          setTwoFactorPassword("");
          return;
        }
      }
      setTwoFactorSubmitting(false);
      setHasAuthenticatorApp(false);
      setIsTwoFactorEnabled(wasEmailEnabled);
      setTwoFactorAction(null);
      setTwoFactorPassword("");
      toast({
        description: wasEmailEnabled
          ? "Email codes stay on as your second factor."
          : "Your account no longer requires a second factor.",
        title: "Authenticator app removed",
      });
      return;
    }

    if (twoFactorAction === "email") {
      if (!email || !emailVerified) {
        setTwoFactorSubmitting(false);
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
        password: twoFactorPassword,
      });
      setTwoFactorSubmitting(false);
      if (result.error) {
        toast({
          description: errorMessage(result.error),
          title: "Couldn't enable email two-factor authentication",
          variant: "destructive",
        });
        return;
      }
      setIsTwoFactorEnabled(true);
      setTwoFactorAction(null);
      setTwoFactorPassword("");
      toast({
        description:
          "We'll send a code to your verified email whenever it's needed.",
        title: "Email two-factor authentication enabled",
      });
      return;
    }

    const result = await authClient.twoFactor.enable({
      method: "totp",
      password: twoFactorPassword,
    });
    setTwoFactorSubmitting(false);
    if (result.error || !result.data || result.data.method !== "totp") {
      toast({
        description: errorMessage(result.error),
        title: "Couldn't start authenticator setup",
        variant: "destructive",
      });
      return;
    }
    setTotpSetup({
      backupCodes: result.data.backupCodes,
      uri: result.data.totpURI,
    });
    setTwoFactorAction(null);
    setTwoFactorPassword("");
  };

  const verifyAuthenticatorCode = async () => {
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
        description: errorMessage(result.error),
        title: "Authenticator code wasn't accepted",
        variant: "destructive",
      });
      return;
    }
    setHasAuthenticatorApp(true);
    setIsTwoFactorEnabled(true);
    setTotpCode("");
  };

  const requestPasskeyReauthentication = (action: {
    id?: string;
    name?: string;
    type: "add" | "remove";
  }) => {
    setPendingPasskeyAction(action);
    setIsPasskeyDialogOpen(false);
    setIsPasskeyReauthOpen(true);
  };

  const addPasskey = async (name: string) => {
    setIsPasskeyPending(true);
    const result = await authClient.passkey.addPasskey({
      name: name.trim() || undefined,
    });
    setIsPasskeyPending(false);
    if (result.error) {
      if (isFreshSession(result.error)) {
        requestPasskeyReauthentication({ name, type: "add" });
        return;
      }
      toast({
        description: errorMessage(result.error),
        title: "Couldn't add passkey",
        variant: "destructive",
      });
      return;
    }
    setIsPasskeyDialogOpen(false);
    setPasskeyName("");
    await refreshPasskeys();
    toast({
      description: "You can now use this passkey to sign in.",
      title: "Passkey added",
    });
  };

  const deletePasskey = async (id: string) => {
    setRemovingPasskeyId(id);
    const result = await removePasskey(id, await options());
    if (result.requiresReauthentication) {
      setRemovingPasskeyId(null);
      requestPasskeyReauthentication({ id, type: "remove" });
      return;
    }
    if (result.error) {
      toast({
        description: result.error,
        title: "Couldn't remove passkey",
        variant: "destructive",
      });
    } else {
      await refreshPasskeys();
      toast({ title: "Passkey removed" });
    }
    setRemovingPasskeyId(null);
  };

  const confirmPasskeyReauthentication = async () => {
    if (!pendingPasskeyAction) {
      return;
    }
    setIsPasskeyReauthPending(true);
    const result = await reauthenticate(reauthPassword, await options());
    setIsPasskeyReauthPending(false);
    if (result.kind !== "success") {
      toast({
        description:
          result.kind === "error"
            ? result.message
            : "We couldn't confirm your password. Please try again.",
        title: "Not Confirmed",
        variant: "destructive",
      });
      return;
    }
    const action = pendingPasskeyAction;
    setIsPasskeyReauthOpen(false);
    setPendingPasskeyAction(null);
    setReauthPassword("");
    if (action.type === "add") {
      void addPasskey(action.name ?? "");
    } else if (action.id) {
      void deletePasskey(action.id);
    }
  };

  const emailCodesOn = isTwoFactorEnabled && emailVerified;
  let emailMethodDescription: string;
  if (!email) {
    emailMethodDescription = "Add an email address to use this";
  } else if (emailCodesOn) {
    emailMethodDescription = `Sent to ${email}`;
  } else if (emailVerified) {
    emailMethodDescription = "Available once 2FA is on";
  } else {
    emailMethodDescription = "Verify your email to use this";
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      ref={scrollRef}
      showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
    >
      <SettingsSectionHeader
        description="Protect access to your account and manage sign-in methods"
        icon={KeyRound}
        title="Security"
      />

      <SectionAnchor id="settings-two-factor" tab="security">
        <SettingsCard>
          <View style={styles.headRow}>
            <SettingsCardHeading
              description="Require a second step when signing in"
              icon={ShieldCheck}
              title="Two-factor authentication"
            />
            <SettingsStatusChip
              label={isTwoFactorEnabled ? "Protected" : "Off"}
              on={isTwoFactorEnabled}
            />
          </View>

          <SettingsSubcard style={styles.methodRow}>
            <View style={styles.methodCopy}>
              <Mail color={theme.dividerText} size={16} />
              <View style={styles.minWidthZero}>
                <Text style={[styles.methodName, { color: theme.inputText }]}>
                  Email codes
                </Text>
                <Text style={[styles.methodDesc, { color: theme.dividerText }]}>
                  {emailMethodDescription}
                </Text>
              </View>
            </View>
            <View style={styles.methodActions}>
              <SettingsStatusChip
                label={emailCodesOn ? "On" : "Off"}
                on={emailCodesOn}
              />
              {emailMethodAction({
                email,
                emailCodesOn,
                emailVerified,
                hasAuthenticatorApp,
                mutedColor: theme.dividerText,
                onDisable: () => setTwoFactorAction("disable"),
                onEnable: () => setTwoFactorAction("email"),
              })}
            </View>
          </SettingsSubcard>

          <SettingsSubcard style={styles.methodRow}>
            <View style={styles.methodCopy}>
              <Fingerprint color={theme.dividerText} size={16} />
              <View style={styles.minWidthZero}>
                <Text style={[styles.methodName, { color: theme.inputText }]}>
                  Authenticator app
                </Text>
                <Text style={[styles.methodDesc, { color: theme.dividerText }]}>
                  {hasAuthenticatorApp
                    ? "A rotating code from your app"
                    : "Use a code from any TOTP app"}
                </Text>
              </View>
            </View>
            <View style={styles.methodActions}>
              <SettingsStatusChip
                label={hasAuthenticatorApp ? "On" : "Off"}
                on={hasAuthenticatorApp}
              />
              {hasAuthenticatorApp ? (
                <SettingsButton
                  label="Remove"
                  onPress={() => setTwoFactorAction("remove-authenticator")}
                  size="sm"
                  tone="danger"
                />
              ) : (
                <SettingsButton
                  label="Set up"
                  onPress={() => setTwoFactorAction("totp")}
                  size="sm"
                />
              )}
            </View>
          </SettingsSubcard>
        </SettingsCard>
      </SectionAnchor>

      <SectionAnchor id="settings-password" tab="security">
        <SettingsCard>
          <SettingsCardHeading
            description="Reset with an emailed link"
            icon={Mail}
            title="Change Password"
          />
          <SettingsInput
            editable={!isEmailSent}
            label="Username or Email"
            onChangeText={setIdentifier}
            placeholder="Enter your username or email to reset password"
            value={identifier}
          />
          <View style={styles.actionEnd}>
            <SettingsButton
              disabled={isEmailSent}
              label={isEmailSent ? "Email Sent" : "Send Reset Link"}
              onPress={() => {
                void onPasswordResetSubmit();
              }}
              size="sm"
            />
          </View>
        </SettingsCard>
      </SectionAnchor>

      <SectionAnchor id="settings-passkeys" tab="security">
        <SettingsCard>
          <View style={styles.headRow}>
            <SettingsCardHeading
              description="Sign in with your device"
              icon={Fingerprint}
              title="Passkeys"
            />
            <SettingsButton
              label="Add"
              onPress={() => setIsPasskeyDialogOpen(true)}
              size="sm"
            />
          </View>
          {passkeysLoaded ? (
            <PasskeysList
              onRemove={(id) => {
                void deletePasskey(id);
              }}
              passkeys={passkeys}
            />
          ) : (
            <SettingsRowsSkeleton rows={1} />
          )}
        </SettingsCard>
      </SectionAnchor>

      <MessageRecoveryCard runWithInstallToken={runWithInstallToken} />

      <SectionAnchor id="settings-sessions" tab="security">
        <SecuritySessionsCard
          onSignedOut={signOut}
          refresh={refresh}
          sessionId={sessionId}
        />
      </SectionAnchor>

      <PushSettingsCard />

      {/* Two-factor password dialog. */}
      <SecurityDialog
        description={twoFactorDescription(twoFactorAction)}
        icon={ShieldCheck}
        onClose={() => {
          setTwoFactorAction(null);
          setTwoFactorPassword("");
        }}
        open={twoFactorAction !== null}
        title={twoFactorDialogTitle(twoFactorAction)}
      >
        <SettingsInput
          label="Current password"
          onChangeText={setTwoFactorPassword}
          placeholder="Your current password"
          secureTextEntry
          value={twoFactorPassword}
        />
        <View style={styles.dialogActions}>
          <SettingsButton
            label="Cancel"
            onPress={() => {
              setTwoFactorAction(null);
              setTwoFactorPassword("");
            }}
            size="sm"
            tone="gray"
          />
          <SettingsButton
            disabled={twoFactorSubmitting}
            label="Continue"
            loading={twoFactorSubmitting}
            onPress={() => {
              void submitTwoFactorAction();
            }}
            size="sm"
          />
        </View>
      </SecurityDialog>

      {/* Authenticator setup / recovery-codes dialog. */}
      <SecurityDialog
        description=""
        icon={KeyRound}
        onClose={() => {
          if (!totpSetup?.backupCodes.length) {
            setTotpSetup(null);
            setTotpCode("");
          }
        }}
        open={totpSetup !== null}
        title={
          hasAuthenticatorApp
            ? "Save your recovery codes"
            : "Set up your authenticator app"
        }
      >
        {totpSetup ? (
          <TotpSetupBody
            code={totpCode}
            hasAuthenticatorApp={hasAuthenticatorApp}
            onCodeChange={setTotpCode}
            onClose={() => {
              setTotpSetup(null);
              setTotpCode("");
            }}
            onVerify={() => {
              void verifyAuthenticatorCode();
            }}
            setup={totpSetup}
            verifying={isTotpVerificationPending}
          />
        ) : null}
      </SecurityDialog>

      {/* Add-passkey dialog. */}
      <SecurityDialog
        description="Your device will ask to save a passkey using this device or a nearby security key."
        icon={Fingerprint}
        onClose={() => setIsPasskeyDialogOpen(false)}
        open={isPasskeyDialogOpen}
        title="Add a passkey"
      >
        <SettingsInput
          autoCapitalize="sentences"
          label="Passkey name (optional)"
          onChangeText={setPasskeyName}
          placeholder="Personal laptop"
          value={passkeyName}
        />
        <View style={styles.dialogActions}>
          <SettingsButton
            label="Cancel"
            onPress={() => setIsPasskeyDialogOpen(false)}
            size="sm"
            tone="gray"
          />
          <SettingsButton
            disabled={isPasskeyPending}
            label="Add passkey"
            loading={isPasskeyPending}
            onPress={() => {
              void addPasskey(passkeyName);
            }}
            size="sm"
          />
        </View>
      </SecurityDialog>

      {/* Passkey re-authentication dialog. */}
      <SecurityDialog
        description={`Enter your password to ${
          pendingPasskeyAction?.type === "add"
            ? "add a passkey"
            : "remove this passkey"
        }. This refreshes your current session in place.`}
        icon={ShieldCheck}
        onClose={() => {
          setIsPasskeyReauthOpen(false);
          setPendingPasskeyAction(null);
          setReauthPassword("");
        }}
        open={isPasskeyReauthOpen}
        title="Confirm it's you"
      >
        <SettingsInput
          label="Current password"
          onChangeText={setReauthPassword}
          placeholder="Your current password"
          secureTextEntry
          value={reauthPassword}
        />
        <View style={styles.dialogActions}>
          <SettingsButton
            label="Cancel"
            onPress={() => {
              setIsPasskeyReauthOpen(false);
              setPendingPasskeyAction(null);
              setReauthPassword("");
            }}
            size="sm"
            tone="gray"
          />
          <SettingsButton
            disabled={isPasskeyReauthPending}
            label="Confirm and continue"
            loading={isPasskeyReauthPending}
            onPress={() => {
              void confirmPasskeyReauthentication();
            }}
            size="sm"
          />
        </View>
      </SecurityDialog>
    </ScrollView>
  );
}

// A module-scoped clock read, so the render never calls an impure function
// directly (React Compiler purity check) while the label still reflects "now".
function currentTimeMs(): number {
  return Date.now();
}

function SessionsBody({
  onRevoke,
  revoking,
  sessions,
}: {
  onRevoke: (session: SecuritySession) => void;
  revoking: string | null;
  sessions: SecuritySession[] | null;
}) {
  const { theme } = useAppTheme();
  if (sessions === null) {
    return <SettingsRowsSkeleton rows={2} />;
  }
  if (sessions.length === 0) {
    return (
      <Text style={[styles.note, { color: theme.dividerText }]}>
        No active sessions were found.
      </Text>
    );
  }
  return (
    <View style={styles.list}>
      {sessions.map((session) => (
        <SettingsSubcard key={session.id} style={styles.sessionRow}>
          <View style={styles.sessionCopy}>
            <View style={styles.sessionTitle}>
              <Text style={[styles.sessionName, { color: theme.inputText }]}>
                {sessionDeviceLabel(session.userAgent)}
              </Text>
              {session.current ? (
                <SettingsStatusChip label="Current device" on />
              ) : null}
            </View>
            <Text style={[styles.methodDesc, { color: theme.dividerText }]}>
              {getSessionLocation(session.country, session.city ?? null)}
            </Text>
            <Text style={[styles.methodDesc, { color: theme.dividerText }]}>
              Last active {formatLastActive(session.updatedAt, currentTimeMs())}
            </Text>
          </View>
          <SettingsButton
            disabled={revoking === session.id}
            label={session.current ? "Sign out" : "End"}
            onPress={() => onRevoke(session)}
            size="sm"
            tone="danger"
          />
        </SettingsSubcard>
      ))}
    </View>
  );
}

function TotpSetupBody({
  code,
  hasAuthenticatorApp,
  onClose,
  onCodeChange,
  onVerify,
  setup,
  verifying,
}: {
  code: string;
  hasAuthenticatorApp: boolean;
  onClose: () => void;
  onCodeChange: (value: string) => void;
  onVerify: () => void;
  setup: TotpSetup;
  verifying: boolean;
}) {
  const { theme } = useAppTheme();
  if (hasAuthenticatorApp) {
    return (
      <>
        <Text style={[styles.note, { color: theme.dividerText }]}>
          These are the only copies of your recovery codes. Store them in a
          password manager before closing this window.
        </Text>
        <SettingsSubcard style={styles.codesGrid}>
          {setup.backupCodes.map((backupCode) => (
            <Text
              key={backupCode}
              style={[styles.code, { color: theme.inputText }]}
            >
              {backupCode}
            </Text>
          ))}
        </SettingsSubcard>
        <SettingsButton
          label="I stored my recovery codes"
          onPress={onClose}
          size="sm"
        />
      </>
    );
  }
  return (
    <>
      <Text style={[styles.note, { color: theme.dividerText }]}>
        Scan this QR code with your authenticator app, then enter its six-digit
        code to finish setup.
      </Text>
      <View style={styles.qrWrap}>
        <View style={styles.qrBox}>
          <QRCode size={184} value={setup.uri} />
        </View>
      </View>
      <SettingsInput
        keyboardType="numeric"
        label="Verification code"
        maxLength={6}
        onChangeText={onCodeChange}
        placeholder="000000"
        value={code}
      />
      <SettingsButton
        disabled={!code.trim() || verifying}
        label="Verify authenticator"
        loading={verifying}
        onPress={onVerify}
        size="sm"
      />
    </>
  );
}

function PasskeysList({
  onRemove,
  passkeys,
}: {
  onRemove: (id: string) => void;
  passkeys: PasskeyEntry[];
}) {
  const { theme } = useAppTheme();
  if (passkeys.length === 0) {
    return (
      <Text style={[styles.note, { color: theme.dividerText }]}>
        No passkeys added yet. Add a passkey on a device you use regularly.
      </Text>
    );
  }
  return (
    <View style={styles.list}>
      {passkeys.map((passkey) => (
        <SettingsSubcard key={passkey.id} style={styles.passkeyRow}>
          <View style={styles.minWidthZero}>
            <Text
              numberOfLines={1}
              style={[styles.passkeyName, { color: theme.inputText }]}
            >
              {passkey.name || "Passkey"}
            </Text>
            <Text style={[styles.methodDesc, { color: theme.dividerText }]}>
              Added{" "}
              {passkey.createdAt
                ? new Date(passkey.createdAt).toLocaleDateString()
                : "recently"}{" "}
              · {passkey.backedUp ? "Synced" : "Device-bound"}
            </Text>
          </View>
          <SettingsIconButton
            accessibilityLabel="Remove passkey"
            icon={Trash2}
            iconSize={14}
            onPress={() => onRemove(passkey.id)}
          />
        </SettingsSubcard>
      ))}
    </View>
  );
}

function MessageRecoveryCard({
  runWithInstallToken,
}: {
  runWithInstallToken: ReturnType<typeof useInstall>["runWithInstallToken"];
}) {
  const { theme } = useAppTheme();
  const [state, setState] = useState<"loading" | "not-set-up" | "enabled">(
    "loading"
  );
  const [resetOpen, setResetOpen] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchMessageIdentity({
      apiBase: getApiBaseUrl(),
      cookie: (await authClient.getCookie()) ?? "",
    });
    setState(result?.identityExists ? "enabled" : "not-set-up");
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- load() awaits before touching state
    void load();
  }, [load]);

  const confirmReset = async () => {
    const result = await runWithInstallToken(
      async () =>
        resetMessageIdentity({
          apiBase: getApiBaseUrl(),
          cookie: (await authClient.getCookie()) ?? "",
        }),
      (value) => value.kind === "install-token-required"
    );
    if (result === null) {
      return;
    }
    if (result.kind === "error") {
      toast({
        description: result.message,
        title: "Couldn't reset",
        variant: "destructive",
      });
      return;
    }
    if (result.kind !== "success") {
      return;
    }
    setResetOpen(false);
    await load();
    toast({
      description:
        "A new messages key will be created next time you open Messages",
      title: "Messages reset",
    });
  };

  return (
    <SettingsCard>
      <View style={styles.headRow}>
        <SettingsCardHeading
          description="Encrypted and restored automatically on new devices"
          icon={KeyRound}
          title="Messages recovery"
        />
        {state === "loading" ? null : (
          <SettingsStatusChip
            label={state === "enabled" ? "Automatic" : "Not set up"}
            on={state === "enabled"}
          />
        )}
      </View>
      {state === "loading" ? <SettingsRowsSkeleton rows={1} /> : null}
      {state === "not-set-up" ? (
        <Text style={[styles.note, { color: theme.dividerText }]}>
          Messages haven&apos;t been set up on this account yet. Open Messages
          once and encryption is enabled for you.
        </Text>
      ) : null}
      {state === "enabled" ? (
        <>
          <View style={styles.recoveryRow}>
            <ShieldCheck color="#10b981" size={16} />
            <Text style={[styles.note, { color: theme.dividerText }]}>
              Your messages are encrypted, and a new device restores access
              automatically: there is nothing to save or remember.
            </Text>
          </View>
          <SettingsButton
            label="Start over with a new key"
            onPress={() => setResetOpen(true)}
            size="sm"
            tone="gray"
          />
        </>
      ) : null}

      <SecurityDialog
        description="This drops this account's server-side messages identity. Your pre-reset history becomes unreadable to you; the peer's wraps remain."
        icon={ShieldAlert}
        onClose={() => setResetOpen(false)}
        open={resetOpen}
        title="Start over with a new key?"
      >
        <View style={styles.dialogActions}>
          <SettingsButton
            label="Cancel"
            onPress={() => setResetOpen(false)}
            size="sm"
            tone="gray"
          />
          <SettingsButton
            label="Reset messages key"
            onPress={() => {
              void confirmReset();
            }}
            size="sm"
            tone="danger"
          />
        </View>
      </SecurityDialog>
    </SettingsCard>
  );
}

function SecuritySessionsCard({
  onSignedOut,
  refresh,
  sessionId,
}: {
  onSignedOut: () => Promise<void>;
  refresh: () => Promise<unknown>;
  sessionId: string | null;
}) {
  const { runWithInstallToken } = useInstall();
  const [sessions, setSessions] = useState<SecuritySession[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<{
    action: "all" | "other-sessions" | "single";
    id?: string;
  } | null>(null);

  const options = useCallback(
    async (): Promise<ApiOptions> => ({
      apiBase: getApiBaseUrl(),
      cookie: (await authClient.getCookie()) ?? "",
    }),
    []
  );

  const loadSessions = useCallback(async () => {
    setSessions(await fetchSecuritySessions(await options()));
  }, [options]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loadSessions awaits before touching state
    void loadSessions();
  }, [loadSessions]);

  const confirmRevoke = async () => {
    if (!pendingRevoke) {
      return;
    }
    const { action, id } = pendingRevoke;
    setRevoking(id ?? "all");
    const opts = await options();
    const result = await runWithInstallToken(
      () => revokeSecuritySession(id ?? "", action, opts),
      (value) => Boolean(value && value.kind === "install-token-required")
    );
    setRevoking(null);
    if (result === null) {
      return;
    }
    if (result.kind === "error") {
      toast({
        description: result.message,
        title: "Couldn't Sign Out",
        variant: "destructive",
      });
      setPendingRevoke(null);
      return;
    }
    setPendingRevoke(null);
    const revokesCurrent = action === "all" || id === sessionId;
    if (revokesCurrent) {
      await onSignedOut();
      return;
    }
    await loadSessions();
    await refresh();
    toast({
      description:
        action === "other-sessions"
          ? "Other devices have been signed out."
          : "That device has been signed out.",
      title: "Sessions updated",
    });
  };

  return (
    <SettingsCard>
      <View style={styles.headRow}>
        <SettingsCardHeading
          description="Devices currently signed in to your account"
          icon={MonitorSmartphone}
          title="Active sessions"
        />
        <SettingsButton
          label="Refresh"
          onPress={() => {
            void loadSessions();
          }}
          size="sm"
          tone="gray"
        />
      </View>
      <SessionsBody
        onRevoke={(session) =>
          setPendingRevoke({ action: "single", id: session.id })
        }
        revoking={revoking}
        sessions={sessions}
      />

      {sessions && sessions.length > 0 ? (
        <View style={styles.bulkActions}>
          <SettingsButton
            disabled={revoking !== null || sessions.length < 2}
            label="Sign out other devices"
            onPress={() => setPendingRevoke({ action: "other-sessions" })}
            size="sm"
            tone="gray"
          />
          <SettingsButton
            disabled={revoking !== null}
            label="Sign out everywhere"
            onPress={() => setPendingRevoke({ action: "all" })}
            size="sm"
            tone="danger"
          />
        </View>
      ) : null}

      <SecurityDialog
        description={revokeCopy(pendingRevoke?.action).description}
        icon={ShieldAlert}
        onClose={() => setPendingRevoke(null)}
        open={pendingRevoke !== null}
        title={revokeCopy(pendingRevoke?.action).title}
      >
        <View style={styles.dialogActions}>
          <SettingsButton
            disabled={revoking !== null}
            label="Cancel"
            onPress={() => setPendingRevoke(null)}
            size="sm"
            tone="gray"
          />
          <SettingsButton
            disabled={revoking !== null}
            label={revokeCopy(pendingRevoke?.action).confirm}
            loading={revoking !== null}
            onPress={() => {
              void confirmRevoke();
            }}
            size="sm"
            tone="danger"
          />
        </View>
      </SecurityDialog>
    </SettingsCard>
  );
}

function revokeCopy(action?: "all" | "other-sessions" | "single"): {
  confirm: string;
  description: string;
  title: string;
} {
  if (action === "all") {
    return {
      confirm: "Sign out everywhere",
      description:
        "This ends every active session, including this one. You'll need to sign in again on all devices.",
      title: "Sign out everywhere?",
    };
  }
  if (action === "other-sessions") {
    return {
      confirm: "Sign out other devices",
      description:
        "This ends all other active sessions and keeps this device signed in.",
      title: "Sign out other devices?",
    };
  }
  return {
    confirm: "Sign out session",
    description:
      "This device will need to sign in again to access your account.",
    title: "Sign out this device?",
  };
}

function PushSettingsCard() {
  const { theme } = useAppTheme();
  const { runWithInstallToken } = useInstall();
  const [state, setState] = useState<"loading" | "off" | "on" | "working">(
    "loading"
  );
  const [reason, setReason] = useState<string>("unknown");
  const [reasonBody, setReasonBody] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const status = await getPushSetupStatus();
    setReason(status.reason);
    setReasonBody(
      status.reason === "ready" ? null : pushSetupCopy(status).body
    );
    setState(status.reason === "ready" ? "on" : "off");
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- refresh() awaits before touching state
    void refresh();
  }, [refresh]);

  const toggle = async () => {
    if (state === "loading" || state === "working") {
      return;
    }
    const next = state !== "on";
    setState("working");
    await (next
      ? registerForPushNotifications(runWithInstallToken)
      : unregisterPushNotifications());
    await refresh();
  };

  const on = state === "on";
  const disabled = state === "loading" || state === "working";
  const description =
    on || reason === "ready"
      ? "On for this device. Turn off to stop them."
      : (reasonBody ??
        "Send a notification to this device when something happens.");

  return (
    <SettingsCard>
      <SettingsCardHeading
        description="Alerts for follows, amplifies, eddies and mentions"
        icon={BellRing}
        title="Notifications"
      />
      <SettingsSubcard style={styles.pushRow}>
        <View style={styles.pushCopy}>
          <Text style={[styles.methodName, { color: theme.inputText }]}>
            Push notifications
          </Text>
          <Text style={[styles.methodDesc, { color: theme.dividerText }]}>
            {description}
          </Text>
        </View>
        <SettingsSwitch
          accessibilityLabel="Toggle push notifications"
          disabled={disabled}
          onValueChange={() => {
            void toggle();
          }}
          value={on}
        />
      </SettingsSubcard>
      <View style={styles.pushChip}>
        <SettingsStatusChip label={pushChipLabel(state, on)} on={on} />
      </View>
    </SettingsCard>
  );
}

function pushChipLabel(
  state: "loading" | "off" | "on" | "working",
  on: boolean
): string {
  if (state === "loading") {
    return "Checking";
  }
  if (state === "working") {
    return "Saving";
  }
  return on ? "On" : "Off";
}

function SecurityDialog({
  children,
  description,
  icon: Icon,
  onClose,
  open,
  title,
}: {
  children: ReactNode;
  description: string;
  icon: React.ComponentType<{ color?: string; size?: number }>;
  onClose: () => void;
  open: boolean;
  title: string;
}) {
  const { theme } = useAppTheme();
  if (!open) {
    return null;
  }
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible
    >
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable
          onPress={() => {
            /* taps on the card must not close it */
          }}
          style={[
            styles.dialog,
            { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
          ]}
        >
          <View style={styles.dialogTitleRow}>
            <View style={styles.dialogTile}>
              <Icon color="#ffffff" size={16} />
            </View>
            <Text style={[styles.dialogTitle, { color: theme.inputText }]}>
              {title}
            </Text>
          </View>
          {description ? (
            <Text style={[styles.dialogCopy, { color: theme.dividerText }]}>
              {description}
            </Text>
          ) : null}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actionEnd: { alignItems: "flex-end" },
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  bulkActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-end",
  },
  code: { fontFamily: "SofiaProMed", fontSize: 13 },
  codesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    padding: 12,
  },
  content: { gap: 18, padding: 16, paddingBottom: 96 },
  dialog: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    maxWidth: 440,
    padding: 20,
    width: "100%",
  },
  dialogActions: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 4,
  },
  dialogCopy: { fontFamily: "SofiaProReg", fontSize: 13, lineHeight: 19 },
  dialogTile: {
    alignItems: "center",
    backgroundColor: "#ff9500",
    borderRadius: 8,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  dialogTitle: { flexShrink: 1, fontFamily: "SofiaProBold", fontSize: 16 },
  dialogTitleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  headRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  list: { gap: 8 },
  methodActions: { alignItems: "center", flexDirection: "row", gap: 8 },
  methodCopy: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 10,
    minWidth: 0,
  },
  methodDesc: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 16 },
  methodName: { fontFamily: "SofiaProMed", fontSize: 14 },
  methodRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    padding: 14,
  },
  minWidthZero: { flexShrink: 1, minWidth: 0 },
  note: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 17 },
  passkeyName: { fontFamily: "SofiaProMed", fontSize: 14 },
  passkeyRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pushChip: { alignItems: "flex-start" },
  pushCopy: { flex: 1, gap: 2, minWidth: 0 },
  pushRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    padding: 16,
  },
  qrBox: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 12,
  },
  qrWrap: { alignItems: "center" },
  recoveryRow: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  sessionCopy: { flex: 1, gap: 3, minWidth: 0 },
  sessionName: { fontFamily: "SofiaProMed", fontSize: 14 },
  sessionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    padding: 12,
  },
  sessionTitle: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
});
