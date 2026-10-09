import { useLocalSearchParams } from "expo-router";
// Native port of web's `settings/tabs/account-settings.tsx`.
//
// The three-stage email change is preserved exactly: an account with a current
// address proves ownership with a code sent to that address before a new one
// can be set, and the new address is then confirmed separately. An account with
// no address at all (a Reddit-only signup) skips straight to confirm-new. The
// username, linked sign-in methods and the add-a-password card match web.
import { AtSign, KeyRound, Mail } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { toast } from "@/components/feedback/toast";
import { OtpInput } from "@/features/auth/components/otp-input";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { getApiBaseUrl } from "@/lib/api-env";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { useAppTheme } from "@/theme";

import {
  changeUsername,
  parseUsernameChange,
  requestEmailChange,
  sendCurrentEmailCode,
  setPassword as submitNewPassword,
  unlinkProvider,
  verifyEmailChange,
} from "../lib/settings-api";
import type { SettingsMutationResult } from "../lib/settings-api";
import { SectionAnchor } from "../lib/settings-scroll";
import type { AccountFacts } from "../lib/settings-view-model";
import { SettingsBrandLogo } from "./settings-brand-logo";
import {
  SettingsButton,
  SettingsCard,
  SettingsCardHeading,
  SettingsInput,
  SettingsSectionHeader,
  SettingsStatusChip,
} from "./settings-ui";

// idle    -> type the new address, press Update Email
// current -> confirm the code sent to the CURRENT address (skipped when the
//            account has none, e.g. Reddit-only sign-ups)
// new     -> confirm the code sent to the NEW address
type EmailStep = "current" | "idle" | "new";

const SOCIAL_PROVIDERS = ["google", "reddit"] as const;
type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

function providerLabel(provider: SocialProvider): string {
  return provider === "google" ? "Google" : "Reddit";
}

// Web starts the link flow with a full-page navigation; native hands it to
// better-auth's expo client, which opens the provider in an auth session.
function linkProvider(provider: SocialProvider) {
  void (async () => {
    try {
      await authClient.linkSocial({
        callbackURL: `/settings?account_success=${provider}`,
        errorCallbackURL: "/settings?account_error=provider_flow_failed",
        provider,
      });
    } catch {
      toast({
        description: "Couldn't start linking, try again?",
        title: "Couldn't Link",
        variant: "destructive",
      });
    }
  })();
}

// Web's `LinkAccountAlert`: the OAuth link callback carries an
// `account_error` or `account_success` query value, surfaced here as a toast.
const LINK_ERROR_MESSAGES: Record<string, string> = {
  account_ownership_conflict:
    "That provider account is already linked to another user",
  already_linked: "This account is already linked to your account",
  cannot_unlink_no_email: "Cannot unlink: No email associated with account",
  cannot_unlink_no_password:
    "Cannot unlink: Need at least one authentication method",
  email_mismatch: "The account email doesn't match your account email",
  google_account_linked_other:
    "This Google account is already linked to another user",
  google_auth_failed: "Google authentication failed. Please try again",
  link_confirmation_required:
    "Confirm that you want to connect this sign-in method first",
  link_requires_password:
    "Add a password before connecting another sign-in method",
  link_requires_verified_email:
    "Add and verify an email address before connecting another sign-in method",
  provider_flow_failed:
    "The provider did not complete account linking. Please try again.",
  social_account_already_linked:
    "That provider account is already linked to another user",
  unauthorized: "You must be logged in to link accounts",
  unknown_error: "An unexpected error occurred. Please try again",
};

const LINK_SUCCESS_MESSAGES: Record<string, string> = {
  google: "Your Google account is now connected",
  google_linked: "Your Google account is now connected",
  google_unlinked: "Your Google account is no longer connected",
  reddit: "Your Reddit account is now connected",
};

export function AccountTab({
  facts,
  onChanged,
  scrollRef,
}: {
  facts: AccountFacts;
  onChanged: () => void;
  scrollRef: RefObject<ScrollView | null>;
}) {
  const { theme } = useAppTheme();
  const { runWithInstallToken } = useInstall();
  const params = useLocalSearchParams<{
    account_error?: string | string[];
    account_success?: string | string[];
    error?: string | string[];
    success?: string | string[];
  }>();

  // Surface the OAuth-link callback result once, exactly like web's
  // LinkAccountAlert.
  useEffect(() => {
    const pick = (value?: string | string[]) =>
      Array.isArray(value) ? value[0] : value;
    const error = pick(params.account_error) ?? pick(params.error);
    const success = pick(params.account_success) ?? pick(params.success);
    if (error) {
      toast({
        description: LINK_ERROR_MESSAGES[error] ?? "An error occurred",
        title: "Link Failed",
        variant: "destructive",
      });
    }
    if (success) {
      toast({
        description: LINK_SUCCESS_MESSAGES[success] ?? "All set!",
        title:
          success === "google_unlinked" ? "Account Unlinked" : "Account Linked",
      });
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the params object identity changes each render
  }, [
    params.account_error,
    params.account_success,
    params.error,
    params.success,
  ]);

  const [username, setUsername] = useState(facts.username);
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameSavedAt, setUsernameSavedAt] = useState<string | null>(null);

  const [email, setEmail] = useState(facts.email ?? "");
  const [pendingNewEmail, setPendingNewEmail] = useState<string | null>(null);
  const [emailStep, setEmailStep] = useState<EmailStep>("idle");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [providerToConfirm, setProviderToConfirm] =
    useState<SocialProvider | null>(null);

  const run = useCallback(
    async (
      action: () => Promise<SettingsMutationResult>,
      onSuccess: () => void,
      failureTitle: string
    ) => {
      const result = await runWithInstallToken(action, (value) =>
        Boolean(value && value.kind === "install-token-required")
      );
      if (result === null) {
        return;
      }
      if (result.kind !== "success") {
        if (result.kind === "error") {
          toast({
            description: result.message,
            title: failureTitle,
            variant: "destructive",
          });
        }
        return;
      }
      onSuccess();
    },
    [runWithInstallToken]
  );

  const submitUsername = () => {
    const next = username.trim().replace(/^@/, "");
    if (!next || next === facts.username) {
      toast({
        description: "That username is already yours, pick a new one",
        title: "No Changes",
      });
      return;
    }
    setSavingUsername(true);
    void (async () => {
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      await run(
        () => changeUsername(next, options),
        () => {
          const parsed = parseUsernameChange(null);
          setUsernameSavedAt(parsed.aliasExpiresAt);
          toast({
            description:
              "Your previous username will redirect here for the next 30 days.",
            title: "Username Updated",
          });
          onChanged();
        },
        "Couldn't Update"
      );
      setSavingUsername(false);
    })();
  };

  // Stage 1 - type the new address. When the account already has an email we
  // first mail a code to the CURRENT address; accounts without one start the
  // change immediately and move straight to the new-email code.
  const beginEmailChange = () => {
    const next = email.trim();
    if (!next || next === facts.email) {
      toast({
        description: "That's already your email, try a new one",
        title: "No Changes",
      });
      return;
    }
    setPendingNewEmail(next);
    setEmailBusy(true);
    void (async () => {
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      if (!facts.email) {
        await run(
          () => requestEmailChange(next, "", options),
          () => {
            setEmailStep("new");
            toast({
              description: `We sent a code to ${next} - enter it to confirm`,
              title: "Check Your Inbox",
            });
          },
          "Couldn't Update"
        );
        setEmailBusy(false);
        return;
      }
      await run(
        () => sendCurrentEmailCode(options),
        () => {
          setEmailStep("current");
          setEmailOtp("");
          toast({
            description: `We emailed a code to ${facts.email}`,
            title: "Code Sent",
          });
        },
        "Couldn't Send Code"
      );
      setEmailBusy(false);
    })();
  };

  const resendCurrentCode = () => {
    void (async () => {
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      await run(
        () => sendCurrentEmailCode(options),
        () => {
          toast({
            description: `We emailed a new code to ${facts.email}`,
            title: "Code Resent",
          });
        },
        "Couldn't Send Code"
      );
    })();
  };

  // Stage 2 - confirm the code sent to the current email. This both proves the
  // owner and triggers the code to the new address.
  const confirmCurrentEmail = () => {
    if (!pendingNewEmail) {
      return;
    }
    setEmailBusy(true);
    void (async () => {
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      await run(
        () => requestEmailChange(pendingNewEmail, emailOtp, options),
        () => {
          setEmailOtp("");
          setEmailStep("new");
          toast({
            description: `We sent a code to ${pendingNewEmail} - enter it to confirm`,
            title: "Check Your Inbox",
          });
        },
        "Couldn't Verify"
      );
      setEmailBusy(false);
    })();
  };

  // Stage 3 - confirm the code sent to the new email address.
  const verifyNewEmail = () => {
    if (!pendingNewEmail) {
      return;
    }
    setEmailBusy(true);
    void (async () => {
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      await run(
        () => verifyEmailChange(pendingNewEmail, emailOtp, options),
        () => {
          setEmailStep("idle");
          setEmailOtp("");
          setEmail(pendingNewEmail);
          setPendingNewEmail(null);
          toast({
            description: "Your email is updated and verified!",
            title: "Email Updated",
          });
          onChanged();
        },
        "Couldn't Verify"
      );
      setEmailBusy(false);
    })();
  };

  const cancelEmailChange = () => {
    setEmailStep("idle");
    setPendingNewEmail(null);
    setEmailOtp("");
    setEmail(facts.email ?? "");
  };

  const submitPassword = () => {
    if (password.length < 8) {
      toast({
        description: "Password must be at least 8 characters",
        title: "Check Your Password",
        variant: "destructive",
      });
      return;
    }
    if (password !== confirmPassword) {
      toast({
        description: "Passwords do not match",
        title: "Check Your Password",
        variant: "destructive",
      });
      return;
    }
    setSavingPassword(true);
    void (async () => {
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      await run(
        () => submitNewPassword(password, options),
        () => {
          setPassword("");
          setConfirmPassword("");
          toast({
            description: "You can now connect another sign-in method.",
            title: "Password Added",
          });
          onChanged();
        },
        "Couldn't Add Password"
      );
      setSavingPassword(false);
    })();
  };

  const disconnect = (provider: SocialProvider) => {
    void (async () => {
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      await run(
        () => unlinkProvider(provider, options),
        () => {
          toast({
            description: `Your ${provider} account is no longer connected`,
            title: "Account Unlinked",
          });
          onChanged();
        },
        "Couldn't Unlink"
      );
    })();
  };

  const isLinkingReady = facts.canLinkProviders;

  let emailStepHint: string | null = null;
  if (emailStep === "current") {
    emailStepHint = `Step 1 of 2 - confirm the code sent to ${facts.email}`;
  } else if (emailStep === "new") {
    emailStepHint = `Step 2 of 2 - confirm the code sent to ${pendingNewEmail}`;
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      ref={scrollRef}
      showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
    >
      <SettingsSectionHeader
        description="Your username, email and sign-in methods"
        icon={AtSign}
        title="Account"
      />

      {facts.hasReddit && !facts.email ? (
        <View
          style={[
            styles.recoveryBanner,
            { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
          ]}
        >
          <View style={styles.recoveryTile}>
            <Mail color="#ffffff" size={16} />
          </View>
          <View style={styles.recoveryBody}>
            <Text style={[styles.recoveryTitle, { color: theme.inputText }]}>
              Add a recovery email
            </Text>
            <Text style={[styles.recoveryCopy, { color: theme.dividerText }]}>
              Reddit doesn&apos;t share your email, so this account has no
              recovery address. Add one so you can reset your password and
              receive account notifications.
            </Text>
          </View>
        </View>
      ) : null}
      {/* One card for identity: username and email are both how people reach
          the account, so they read better as one surface with two parts. */}
      <SettingsCard>
        <SectionAnchor
          id="settings-username"
          style={styles.cardSection}
          tab="account"
        >
          <SettingsCardHeading
            description="How people find you on asocialmedia"
            icon={AtSign}
            title="Username"
          />
          <SettingsInput
            label="Username"
            leadingText="@"
            maxLength={20}
            onChangeText={setUsername}
            placeholder="yourname"
            value={username}
          />
          <Text style={[styles.note, { color: theme.dividerText }]}>
            {usernameSavedAt
              ? `Your previous username redirects here until ${new Date(
                  usernameSavedAt
                ).toLocaleDateString()}. You can make up to 5 username changes every 30 days.`
              : "Your previous username stays reserved and redirects here for 30 days. You can make up to 5 username changes every 30 days."}
          </Text>
          <View style={styles.actionEnd}>
            <SettingsButton
              disabled={savingUsername}
              label={savingUsername ? "Updating…" : "Update Username"}
              onPress={submitUsername}
              size="sm"
            />
          </View>
        </SectionAnchor>

        <View style={[styles.divider, { backgroundColor: theme.cardBorder }]} />

        <SectionAnchor
          afterId="settings-username"
          id="settings-email"
          style={styles.cardSection}
          tab="account"
        >
          <SettingsCardHeading
            description="Where we send login and reset links"
            icon={Mail}
            title="Email Address"
          />

          {emailStepHint ? (
            <Text style={[styles.stepHint, { color: theme.dividerText }]}>
              {emailStepHint}
            </Text>
          ) : null}

          {emailStep === "idle" ? (
            <>
              <SettingsInput
                keyboardType="email-address"
                label="Email"
                onChangeText={setEmail}
                placeholder="you@example.com"
                value={email}
              />
              <View style={styles.actionEnd}>
                <SettingsButton
                  disabled={emailBusy}
                  label={emailBusy ? "Sending…" : "Update Email"}
                  onPress={beginEmailChange}
                  size="sm"
                />
              </View>
            </>
          ) : null}

          {emailStep === "current" ? (
            <>
              <SettingsInput
                editable={false}
                keyboardType="email-address"
                label="Email"
                onChangeText={setEmail}
                value={email}
              />
              <Text style={[styles.fieldLabel, { color: theme.dividerText }]}>
                Verification code
              </Text>
              <OtpInput onChange={setEmailOtp} value={emailOtp} />
              <View style={styles.rowBetween}>
                <SettingsButton
                  label="Resend code"
                  onPress={resendCurrentCode}
                  size="sm"
                  tone="gray"
                />
                <View style={styles.rowGap}>
                  <SettingsButton
                    label="Cancel"
                    onPress={cancelEmailChange}
                    size="sm"
                    tone="gray"
                  />
                  <SettingsButton
                    disabled={emailBusy}
                    label="Continue"
                    loading={emailBusy}
                    onPress={confirmCurrentEmail}
                    size="sm"
                  />
                </View>
              </View>
            </>
          ) : null}

          {emailStep === "new" ? (
            <>
              <SettingsInput
                editable={false}
                keyboardType="email-address"
                label="New email"
                onChangeText={() => {
                  /* empty */
                }}
                value={pendingNewEmail ?? ""}
              />
              <Text style={[styles.fieldLabel, { color: theme.dividerText }]}>
                Verification code
              </Text>
              <OtpInput onChange={setEmailOtp} value={emailOtp} />
              <View style={styles.actionEndGap}>
                <SettingsButton
                  label="Cancel"
                  onPress={cancelEmailChange}
                  size="sm"
                  tone="gray"
                />
                <SettingsButton
                  disabled={emailBusy}
                  label="Verify & Change"
                  loading={emailBusy}
                  onPress={verifyNewEmail}
                  size="sm"
                />
              </View>
            </>
          ) : null}
        </SectionAnchor>
      </SettingsCard>

      <SectionAnchor id="settings-linked-accounts" tab="account">
        <View style={styles.section}>
          <SettingsCardHeading
            description="Add another way to sign in"
            icon={KeyRound}
            title="Sign-in methods"
          />
          {isLinkingReady ? null : (
            <Text style={[styles.note, { color: theme.dividerText }]}>
              Verify an email address and add a password before connecting
              another sign-in method.
            </Text>
          )}
          <View style={styles.providerGrid}>
            {SOCIAL_PROVIDERS.map((provider) => (
              <ProviderCard
                isConnected={facts.linkedProviders.includes(provider)}
                isLinkingReady={isLinkingReady}
                key={provider}
                onPress={() => {
                  if (facts.linkedProviders.includes(provider)) {
                    disconnect(provider);
                  } else {
                    setProviderToConfirm(provider);
                  }
                }}
                provider={provider}
              />
            ))}
          </View>
        </View>
      </SectionAnchor>

      {facts.hasPassword ? null : (
        <SectionAnchor
          id="settings-add-password"
          style={styles.cardSection}
          tab="account"
        >
          <SettingsCard>
            <SettingsCardHeading
              description="Add a backup way to sign in before connecting another provider"
              icon={KeyRound}
              title="Add a Password"
            />
            {facts.emailVerified ? (
              <>
                <SettingsInput
                  label="New password"
                  onChangeText={setPassword}
                  secureTextEntry
                  value={password}
                />
                <SettingsInput
                  label="Confirm password"
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  value={confirmPassword}
                />
                <View style={styles.actionEnd}>
                  <SettingsButton
                    disabled={savingPassword}
                    label="Add Password"
                    loading={savingPassword}
                    onPress={submitPassword}
                    size="sm"
                  />
                </View>
              </>
            ) : (
              <Text style={[styles.note, { color: theme.dividerText }]}>
                Add and verify an email address above first. This protects your
                account if you lose access to a connected provider.
              </Text>
            )}
          </SettingsCard>
        </SectionAnchor>
      )}
      <Modal
        animationType="fade"
        onRequestClose={() => setProviderToConfirm(null)}
        transparent
        visible={providerToConfirm !== null}
      >
        <Pressable
          onPress={() => setProviderToConfirm(null)}
          style={styles.backdrop}
        >
          <Pressable
            onPress={() => {
              /* taps on the card must not close the sheet */
            }}
            style={[
              styles.dialog,
              { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
            ]}
          >
            <View style={styles.dialogTitleRow}>
              <View style={styles.dialogTile}>
                <KeyRound color="#ffffff" size={16} />
              </View>
              <Text style={[styles.dialogTitle, { color: theme.inputText }]}>
                Connect{" "}
                {providerToConfirm
                  ? providerLabel(providerToConfirm)
                  : "account"}
                ?
              </Text>
            </View>
            <Text style={[styles.dialogCopy, { color: theme.dividerText }]}>
              Choose the account you want to use as another sign-in method.
            </Text>
            {providerToConfirm ? (
              <View
                style={[
                  styles.dialogProvider,
                  { borderColor: theme.cardBorder },
                ]}
              >
                <SettingsBrandLogo provider={providerToConfirm} size={24} />
                <View style={styles.minWidthZero}>
                  <Text
                    style={[
                      styles.dialogProviderName,
                      { color: theme.inputText },
                    ]}
                  >
                    {providerLabel(providerToConfirm)}
                  </Text>
                  <Text
                    style={[styles.dialogCopy, { color: theme.dividerText }]}
                  >
                    Additional sign-in method
                  </Text>
                </View>
              </View>
            ) : null}
            <Text style={[styles.dialogCopy, { color: theme.dividerText }]}>
              If its email differs from{" "}
              <Text
                style={{ color: theme.inputText, fontFamily: "SofiaProMed" }}
              >
                {facts.email}
              </Text>
              , it will be added to this account without replacing your account
              email.
            </Text>
            <View style={styles.dialogActions}>
              <SettingsButton
                label="Cancel"
                onPress={() => setProviderToConfirm(null)}
                size="sm"
                tone="gray"
              />
              <SettingsButton
                label={`Continue to ${
                  providerToConfirm
                    ? providerLabel(providerToConfirm)
                    : "provider"
                }`}
                onPress={() => {
                  const provider = providerToConfirm;
                  setProviderToConfirm(null);
                  if (provider) {
                    linkProvider(provider);
                  }
                }}
                size="sm"
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function ProviderCard({
  isConnected,
  isLinkingReady,
  onPress,
  provider,
}: {
  isConnected: boolean;
  isLinkingReady: boolean;
  onPress: () => void;
  provider: SocialProvider;
}) {
  const { theme } = useAppTheme();
  return (
    <SettingsCard style={styles.providerCard}>
      <View style={styles.providerHead}>
        <SettingsBrandLogo provider={provider} size={28} />
        <View style={styles.minWidthZero}>
          <Text style={[styles.providerName, { color: theme.inputText }]}>
            {providerLabel(provider)}
          </Text>
          <View style={styles.providerChip}>
            <SettingsStatusChip
              label={isConnected ? "Connected" : "Not connected"}
              on={isConnected}
            />
          </View>
        </View>
      </View>
      <View style={styles.providerAction}>
        <SettingsButton
          block
          disabled={!isConnected && !isLinkingReady}
          label={providerButtonLabel(isConnected)}
          onPress={onPress}
          size="sm"
          tone={isConnected ? "gray" : "primary"}
        />
      </View>
    </SettingsCard>
  );
}

function providerButtonLabel(isConnected: boolean): string {
  return isConnected ? "Disconnect" : "Connect";
}

const styles = StyleSheet.create({
  actionEnd: { alignItems: "flex-end" },
  actionEndGap: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
  },
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  // The card's own `gap` cannot reach children wrapped in a SectionAnchor, so
  // each anchored section carries the same 12px rhythm the card uses.
  cardSection: { gap: 12 },
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
  dialogProvider: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  dialogProviderName: { fontFamily: "SofiaProMed", fontSize: 14 },
  dialogTile: {
    alignItems: "center",
    backgroundColor: "#ff9500",
    borderRadius: 8,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  dialogTitle: { fontFamily: "SofiaProBold", fontSize: 16 },
  dialogTitleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  divider: { height: 1, marginVertical: 6 },
  fieldLabel: { fontFamily: "SofiaProMed", fontSize: 13 },
  minWidthZero: { flexShrink: 1, minWidth: 0 },
  note: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 17 },
  providerAction: { marginTop: "auto" },
  providerCard: { flexGrow: 1, gap: 14, minHeight: 156, width: "48%" },
  providerChip: { marginTop: 4 },
  providerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    justifyContent: "space-between",
  },
  providerHead: { flexDirection: "row", gap: 12 },
  providerName: { fontFamily: "SofiaProBold", fontSize: 15 },
  recoveryBanner: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 16,
  },
  recoveryBody: { flex: 1, gap: 4 },
  recoveryCopy: { fontFamily: "SofiaProReg", fontSize: 13, lineHeight: 18 },
  recoveryTile: {
    alignItems: "center",
    backgroundColor: "#ff4500",
    borderRadius: 9999,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  recoveryTitle: { fontFamily: "SofiaProMed", fontSize: 14 },
  rowBetween: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rowGap: { flexDirection: "row", gap: 8 },
  section: { gap: 12 },
  stepHint: { fontFamily: "SofiaProMed", fontSize: 12 },
});
