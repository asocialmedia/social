// Native port of web's `settings/tabs/account-settings.tsx`.
//
// The flow is unchanged from web, including the three-stage email change: an
// account with a current address proves ownership with a code sent to that
// address before a new one can be set, and the new address is then confirmed
// separately. An account with no address at all (a Reddit-only signup) skips
// straight to the confirm-new step.
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

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
import type { AccountFacts } from "../lib/settings-view-model";
import {
  SettingsButton,
  SettingsCard,
  SettingsCardHeading,
  SettingsInput,
  SettingsSectionHeader,
  SettingsStatusChip,
} from "./settings-ui";

type EmailStep = "idle" | "new" | "verify-new";

export function AccountTab({
  facts,
  onChanged,
}: {
  facts: AccountFacts;
  onChanged: () => void;
}) {
  const { theme } = useAppTheme();
  const { runWithInstallToken } = useInstall();

  const [username, setUsername] = useState(facts.username);
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameSavedAt, setUsernameSavedAt] = useState<string | null>(null);

  const [email, setEmail] = useState(facts.email ?? "");
  const [emailStep, setEmailStep] = useState<EmailStep>("idle");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

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
        description: "That's already your username",
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
            description: "Your old username now redirects here for 30 days.",
            title: "Username Updated",
          });
          onChanged();
        },
        "Couldn't Update"
      );
      setSavingUsername(false);
    })();
  };

  const beginEmailChange = () => {
    const next = email.trim();
    if (!next) {
      toast({
        description: "Please enter a valid email address",
        title: "Check Your Inbox",
        variant: "destructive",
      });
      return;
    }
    if (next === facts.email) {
      toast({
        description: "That's already your email, try a new one",
        title: "No Changes",
      });
      return;
    }
    setEmailBusy(true);
    void (async () => {
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      // With a current address on file, ownership of it has to be proven first.
      if (!facts.email) {
        setEmailStep("new");
        setEmailBusy(false);
        return;
      }
      await run(
        () => sendCurrentEmailCode(options),
        () => {
          setEmailStep("verify-new");
          toast({
            description: `We sent a code to ${facts.email}`,
            title: "Code Sent",
          });
        },
        "Couldn't Send Code"
      );
      setEmailBusy(false);
    })();
  };

  const confirmCurrentEmail = () => {
    setEmailBusy(true);
    void (async () => {
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      await run(
        () => requestEmailChange(email.trim(), emailOtp, options),
        () => {
          setEmailStep("new");
          setEmailOtp("");
          toast({
            description: "Now confirm the new address.",
            title: "Check Your Inbox",
          });
        },
        "Couldn't Verify"
      );
      setEmailBusy(false);
    })();
  };

  const confirmNewEmail = () => {
    setEmailBusy(true);
    void (async () => {
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      await run(
        () => verifyEmailChange(email.trim(), emailOtp, options),
        () => {
          setEmailStep("idle");
          setEmailOtp("");
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

  const disconnect = (provider: string) => {
    void (async () => {
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      await run(
        () => unlinkProvider(provider, options),
        () => {
          toast({
            description: "That account is disconnected.",
            title: "Disconnected",
          });
          onChanged();
        },
        "Couldn't Disconnect"
      );
    })();
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
    >
      <SettingsSectionHeader
        description="Your username, email and sign-in methods"
        title="Account"
      />

      {facts.email === null ? (
        <View
          style={[
            styles.banner,
            {
              backgroundColor: theme.errorBannerBg,
              borderColor: theme.errorBannerBorder,
            },
          ]}
        >
          <Text style={[styles.bannerText, { color: theme.errorBannerText }]}>
            Add an email address so you can recover this account if you lose
            your Reddit sign-in.
          </Text>
        </View>
      ) : null}

      <SettingsCard>
        <SettingsCardHeading
          action={<SettingsStatusChip label={`@${facts.username}`} />}
        >
          <Text style={[styles.cardTitle, { color: theme.inputText }]}>
            Username
          </Text>
          <Text style={[styles.cardHint, { color: theme.dividerText }]}>
            How people find you on asocialmedia
          </Text>
        </SettingsCardHeading>
        <SettingsInput
          label="Username"
          maxLength={20}
          onChangeText={setUsername}
          placeholder="yourname"
          value={username}
        />
        {usernameSavedAt ? (
          <Text style={[styles.note, { color: theme.dividerText }]}>
            Your previous username redirects here until{" "}
            {new Date(usernameSavedAt).toLocaleDateString()}, and you can change
            it 5 times every 30 days.
          </Text>
        ) : (
          <Text style={[styles.note, { color: theme.dividerText }]}>
            Your old username keeps redirecting here for 30 days, and you can
            change it 5 times every 30 days.
          </Text>
        )}
        <SettingsButton
          disabled={savingUsername}
          label={savingUsername ? "Updating…" : "Update Username"}
          onPress={submitUsername}
        />
      </SettingsCard>

      <SettingsCard>
        <SettingsCardHeading
          action={
            <SettingsStatusChip
              label={facts.emailVerified ? "Verified" : "Unverified"}
              tone={facts.emailVerified ? "primary" : "danger"}
            />
          }
        >
          <Text style={[styles.cardTitle, { color: theme.inputText }]}>
            Email Address
          </Text>
          <Text style={[styles.cardHint, { color: theme.dividerText }]}>
            Where we send login and reset links
          </Text>
        </SettingsCardHeading>
        {emailStep === "idle" ? (
          <>
            <SettingsInput
              keyboardType="email-address"
              label="Email address"
              onChangeText={setEmail}
              placeholder="you@example.com"
              value={email}
            />
            <SettingsButton
              disabled={emailBusy}
              label={emailBusy ? "Sending…" : "Update Email"}
              onPress={beginEmailChange}
            />
          </>
        ) : null}
        {emailStep === "verify-new" ? (
          <View style={styles.stage}>
            <Text style={[styles.note, { color: theme.dividerText }]}>
              Step 1 of 2 – confirm the code sent to {facts.email}
            </Text>
            <OtpInput onChange={setEmailOtp} value={emailOtp} />
            <SettingsButton
              disabled={emailBusy || emailOtp.length < 4}
              label={emailBusy ? "Checking…" : "Continue"}
              onPress={confirmCurrentEmail}
            />
            <SettingsButton
              label="Resend code"
              onPress={() => {
                void (async () => {
                  const options = {
                    apiBase: getApiBaseUrl(),
                    cookie: await authClient.getCookie(),
                  };
                  await run(
                    () => sendCurrentEmailCode(options),
                    () => {
                      toast({
                        description: "A new code is on its way.",
                        title: "Code Resent",
                      });
                    },
                    "Couldn't Send Code"
                  );
                })();
              }}
              tone="neutral"
            />
            <SettingsButton
              label="Cancel"
              onPress={() => {
                setEmailStep("idle");
                setEmailOtp("");
              }}
              tone="neutral"
            />
          </View>
        ) : null}
        {emailStep === "new" ? (
          <View style={styles.stage}>
            <Text style={[styles.note, { color: theme.dividerText }]}>
              Step 2 of 2 – confirm the code sent to {email}
            </Text>
            <OtpInput onChange={setEmailOtp} value={emailOtp} />
            <SettingsButton
              disabled={emailBusy || emailOtp.length < 4}
              label={emailBusy ? "Verifying…" : "Verify & Change"}
              onPress={confirmNewEmail}
            />
            <SettingsButton
              label="Cancel"
              onPress={() => {
                setEmailStep("idle");
                setEmailOtp("");
              }}
              tone="neutral"
            />
          </View>
        ) : null}
      </SettingsCard>

      <SettingsCard>
        <SettingsCardHeading>
          <Text style={[styles.cardTitle, { color: theme.inputText }]}>
            Sign-in methods
          </Text>
          <Text style={[styles.cardHint, { color: theme.dividerText }]}>
            Add another way to sign in
          </Text>
        </SettingsCardHeading>
        {(["google", "reddit"] as const).map((provider) => {
          const linked = facts.linkedProviders.includes(provider);
          return (
            <View key={provider} style={styles.provider}>
              <Text style={[styles.providerName, { color: theme.inputText }]}>
                {provider === "google" ? "Google" : "Reddit"}
              </Text>
              <View style={styles.providerControls}>
                <SettingsStatusChip
                  label={linked ? "Connected" : "Not connected"}
                  tone={linked ? "primary" : "neutral"}
                />
                {linked ? (
                  <SettingsButton
                    label="Disconnect"
                    onPress={() => {
                      disconnect(provider);
                    }}
                    tone="danger"
                  />
                ) : (
                  <Text style={[styles.locked, { color: theme.dividerText }]}>
                    {facts.canLinkProviders
                      ? "Connect"
                      : "Verify email + add a password first"}
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </SettingsCard>

      {facts.hasPassword ? null : (
        <SettingsCard>
          <SettingsCardHeading>
            <Text style={[styles.cardTitle, { color: theme.inputText }]}>
              Add a Password
            </Text>
            <Text style={[styles.cardHint, { color: theme.dividerText }]}>
              Add a backup way to sign in before connecting another provider
            </Text>
          </SettingsCardHeading>
          {facts.emailVerified ? (
            <>
              <SettingsInput
                label="Password"
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
              <SettingsButton
                disabled={savingPassword}
                label={savingPassword ? "Adding…" : "Add Password"}
                onPress={submitPassword}
              />
            </>
          ) : (
            <Text style={[styles.note, { color: theme.dividerText }]}>
              Verify your email address before adding a password, so this
              account stays recoverable.
            </Text>
          )}
        </SettingsCard>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  bannerText: { fontFamily: "SofiaProReg", fontSize: 13, lineHeight: 18 },
  cardHint: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 2 },
  cardTitle: { fontFamily: "SofiaProMed", fontSize: 15 },
  content: { gap: 14, padding: 16, paddingBottom: 40 },
  locked: { fontFamily: "SofiaProReg", fontSize: 12 },
  note: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 17 },
  provider: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  providerControls: { alignItems: "flex-end", gap: 6 },
  providerName: { fontFamily: "SofiaProMed", fontSize: 14 },
  stage: { gap: 10 },
});
