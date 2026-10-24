import type {
  AccountResolutionProfile,
  AccountResolutionReview,
} from "@asm/auth/validation";
import { Check, GitMerge, ShieldCheck, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { DialogPanel } from "@/components/surface/dialog-panel";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { getApiBaseUrl } from "@/lib/api-env";
import { withAuthHeaders } from "@/lib/auth-headers";
import { useAppTheme } from "@/theme";

import { SettingsButton, SettingsCard, SettingsInput } from "./settings-ui";

async function requestResolution(id: string, body?: unknown) {
  const response = await fetch(
    `${getApiBaseUrl()}/api/users/account-resolution/${id}`,
    {
      credentials: "omit",
      headers: withAuthHeaders(
        body ? { "content-type": "application/json" } : {},
        await authClient.getCookie()
      ),
      method: body ? "POST" : "GET",
      ...(body ? { body: JSON.stringify(body) } : {}),
    }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      data.error || data.message || "Could not review these accounts."
    );
  }
  return data as Record<string, unknown>;
}

function VerifyAccount({
  id,
  side,
  profile,
  refresh,
}: {
  id: string;
  side: "current" | "other";
  profile: AccountResolutionProfile;
  refresh: () => Promise<void>;
}) {
  const { theme } = useAppTheme();
  const [email, setEmail] = useState(profile.email ?? "");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [emailReady, setEmailReady] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const [method, setMethod] = useState<"totp" | "otp" | "backup-code">("totp");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const needsSetup = !profile.hasPassword || !profile.emailVerified;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setErrorMessage("");
    try {
      await action();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Please try again."
      );
    }
    setBusy(false);
  }
  return (
    <SettingsCard style={{ gap: 12 }}>
      <Text
        style={{
          color: theme.inputText,
          fontFamily: "SofiaProBold",
          fontSize: 14,
        }}
      >
        @{profile.username}
        {profile.verified ? " · Verified" : ""}
      </Text>
      {!profile.verified &&
        (needsSetup ? (
          <>
            <Text style={{ color: theme.dividerText, fontSize: 12 }}>
              Verify a recovery email and add a password here before continuing.
            </Text>
            <SettingsInput
              label="Recovery email"
              keyboardType="email-address"
              editable={!profile.email && !busy && !emailReady}
              value={email}
              onChangeText={setEmail}
            />
            {!emailReady && (
              <>
                <SettingsButton
                  label={sent ? "Resend email code" : "Send email code"}
                  tone="gray"
                  loading={busy}
                  disabled={!email}
                  onPress={() =>
                    run(async () => {
                      await requestResolution(id, {
                        action: "code",
                        email,
                        side,
                      });
                      setSent(true);
                    })
                  }
                />
                {sent && (
                  <>
                    <SettingsInput
                      label="Email verification code"
                      keyboardType="numeric"
                      maxLength={6}
                      value={code}
                      onChangeText={setCode}
                    />
                    <SettingsButton
                      label="Verify email"
                      tone="gray"
                      loading={busy}
                      disabled={code.length !== 6}
                      onPress={() =>
                        run(async () => {
                          await requestResolution(id, {
                            action: "code",
                            email,
                            otp: code,
                            side,
                          });
                          setEmailReady(true);
                          setCode("");
                        })
                      }
                    />
                  </>
                )}
              </>
            )}
            {emailReady && (
              <>
                {!profile.hasPassword && (
                  <>
                    <SettingsInput
                      label="New password"
                      secureTextEntry
                      value={password}
                      onChangeText={setPassword}
                    />
                    <SettingsInput
                      label="Confirm password"
                      secureTextEntry
                      value={repeat}
                      onChangeText={setRepeat}
                    />
                  </>
                )}
                <SettingsButton
                  label="Save recovery details"
                  loading={busy}
                  disabled={
                    !profile.hasPassword &&
                    (password.length < 8 || password !== repeat)
                  }
                  onPress={() =>
                    run(async () => {
                      await requestResolution(id, {
                        action: "setup",
                        side,
                        ...(profile.hasPassword ? {} : { password }),
                      });
                      setEmailReady(false);
                      setPassword("");
                      setRepeat("");
                      await refresh();
                    })
                  }
                />
              </>
            )}
          </>
        ) : (
          <>
            {twoFactor ? (
              <>
                <View style={{ gap: 6 }}>
                  {(["totp", "otp", "backup-code"] as const).map((value) => (
                    <SettingsButton
                      key={value}
                      size="sm"
                      tone={method === value ? "primary" : "gray"}
                      label={
                        {
                          "backup-code": "Backup code",
                          otp: "Email code",
                          totp: "Authenticator app",
                        }[value]
                      }
                      onPress={() => setMethod(value)}
                    />
                  ))}
                </View>
                {method === "otp" && (
                  <SettingsButton
                    label="Send two-factor code"
                    tone="gray"
                    loading={busy}
                    onPress={() =>
                      run(async () => {
                        await requestResolution(id, {
                          action: "verify",
                          method: "send-otp",
                          side,
                        });
                      })
                    }
                  />
                )}
                <SettingsInput
                  label="Two-factor code"
                  value={code}
                  onChangeText={setCode}
                />
                <SettingsButton
                  label="Use password again"
                  tone="gray"
                  onPress={() => {
                    setTwoFactor(false);
                    setCode("");
                  }}
                />
              </>
            ) : (
              <SettingsInput
                label={`Password for @${profile.username}`}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            )}
            <SettingsButton
              label="Verify account"
              leadingIcon={ShieldCheck}
              tone="gray"
              loading={busy}
              disabled={!(twoFactor ? code : password)}
              onPress={() =>
                run(async () => {
                  const result = await requestResolution(id, {
                    action: "verify",
                    side,
                    ...(twoFactor ? { code, method } : { password }),
                  });
                  setPassword("");
                  setCode("");
                  if (result.twoFactorRequired) {
                    setTwoFactor(true);
                  } else {
                    setTwoFactor(false);
                    await refresh();
                  }
                })
              }
            />
          </>
        ))}
      {errorMessage ? (
        <Text
          accessibilityRole="alert"
          selectable
          style={{ color: theme.errorBannerText, fontSize: 12 }}
        >
          {errorMessage}
        </Text>
      ) : null}
    </SettingsCard>
  );
}

export function AccountResolutionDialog({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { theme } = useAppTheme();
  const { signOut } = useSessionContext();
  const [review, setReview] = useState<AccountResolutionReview | null>(null);
  const [keepId, setKeepId] = useState("");
  const [mode, setMode] = useState<"merge" | "discard" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const refresh = useCallback(async () => {
    const data = (await requestResolution(
      id
    )) as unknown as AccountResolutionReview;
    setReview(data);
    setKeepId((previous) => previous || data.current.id);
  }, [id]);
  useEffect(() => {
    (async () => {
      try {
        await refresh();
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Could not load accounts."
        );
      }
    })();
  }, [refresh]);
  const kept =
    review && (review.current.id === keepId ? review.current : review.other);
  const lost =
    review && (review.current.id === keepId ? review.other : review.current);
  let protectedReason: string | null = null;
  if (lost?.protectedAccount) {
    protectedReason =
      "Keep the account with the author or administrative role.";
  } else if (lost?.ownsDen) {
    protectedReason = "Transfer this account's dens before retiring it.";
  }
  const mergeReason =
    protectedReason ||
    (lost?.privateHistory
      ? "Encrypted conversations cannot be transferred. Keep this profile instead to preserve them."
      : null);
  const discardReason =
    protectedReason ||
    (lost?.communities
      ? "Transfer this account's communities before deleting its content."
      : null);
  const ready = Boolean(
    review?.current.verified &&
    review.other.verified &&
    confirmation === lost?.username &&
    acknowledged &&
    !(mode === "merge" ? mergeReason : discardReason)
  );
  async function cancel() {
    if (busy || complete) {
      return;
    }
    setBusy(true);
    try {
      if (review) {
        await requestResolution(id, { action: "cancel" });
      }
      onClose();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not cancel."
      );
    }
    setBusy(false);
  }
  return (
    <DialogPanel
      title={complete ? "Accounts resolved" : "Two accounts, your choice"}
      description={
        complete
          ? "Sign in again with the profile you kept."
          : "This sign-in method or email belongs to another asocialmedia profile. Choose what happens to both accounts."
      }
      busy={busy || complete}
      onClose={cancel}
    >
      <View style={{ gap: 14 }}>
        {complete ? (
          <SettingsButton
            label="Continue to sign in"
            onPress={() => signOut({ reason: "account-resolution" })}
          />
        ) : (
          <>
            {!review && !errorMessage ? (
              <ActivityIndicator color={theme.inputText} />
            ) : null}
            {review && (
              <>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  {[review.current, review.other].map((profile) => (
                    <Pressable
                      key={profile.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: profile.id === keepId }}
                      disabled={busy}
                      onPress={() => {
                        setKeepId(profile.id);
                        setAcknowledged(false);
                        setConfirmation("");
                      }}
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <SettingsCard
                        style={{
                          alignItems: "center",
                          borderColor:
                            profile.id === keepId
                              ? theme.auxLink
                              : theme.cardBorder,
                          gap: 8,
                        }}
                      >
                        <UserAvatar
                          size={54}
                          url={profile.avatarUrl}
                          username={profile.username}
                        />
                        <Text
                          numberOfLines={1}
                          style={{
                            color: theme.inputText,
                            fontFamily: "SofiaProBold",
                            fontSize: 13,
                          }}
                        >
                          {profile.displayName}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={{ color: theme.dividerText, fontSize: 11 }}
                        >
                          @{profile.username}
                        </Text>
                        <Text
                          style={{ color: theme.dividerText, fontSize: 10 }}
                        >
                          {profile.posts} posts · {profile.comments} comments
                        </Text>
                        <Text
                          style={{ color: theme.dividerText, fontSize: 10 }}
                        >
                          {profile.providers.join(" + ") || "Email & password"}
                        </Text>
                        <Text style={{ color: theme.inputText, fontSize: 11 }}>
                          {profile.id === keepId
                            ? "✓ Keep this profile"
                            : "Choose this profile"}
                        </Text>
                      </SettingsCard>
                    </Pressable>
                  ))}
                </View>
                <Text style={{ color: theme.dividerText, fontSize: 12 }}>
                  The chosen profile keeps its email, password, passkeys and
                  two-factor settings. Providers move to it. All sessions end
                  after completion.
                </Text>
                {review.kind === "email" && (
                  <Text style={{ color: theme.inputText, fontSize: 12 }}>
                    The requested email stays with its existing profile. Keep
                    that profile to continue using that email. Changing an email
                    alone never merges accounts.
                  </Text>
                )}
                {mode ? (
                  <>
                    <SettingsButton
                      label="Back to choices"
                      tone="gray"
                      disabled={busy}
                      onPress={() => {
                        setMode(null);
                        setAcknowledged(false);
                        setConfirmation("");
                      }}
                    />
                    <VerifyAccount
                      id={id}
                      side="current"
                      profile={review.current}
                      refresh={refresh}
                    />
                    <VerifyAccount
                      id={id}
                      side="other"
                      profile={review.other}
                      refresh={refresh}
                    />
                    <Text
                      style={{
                        color:
                          mode === "discard"
                            ? theme.errorBannerText
                            : theme.dividerText,
                        fontSize: 12,
                      }}
                    >
                      {mode === "discard"
                        ? `Permanently delete @${lost?.username}'s ${lost?.posts} posts and their replies, ${lost?.comments} comments, private messages, bookmarks and social connections. This cannot be undone.`
                        : `Move @${lost?.username}'s posts, comments, communities, follows and bookmarks into @${kept?.username}. Duplicate relationships keep the chosen profile's entry. The old username redirects for 30 days.`}
                    </Text>
                    <SettingsButton
                      tone={acknowledged ? "primary" : "gray"}
                      leadingIcon={acknowledged ? Check : undefined}
                      label="I understand this cannot be undone"
                      onPress={() => setAcknowledged(!acknowledged)}
                    />
                    <SettingsInput
                      label={`Type ${lost?.username} to confirm`}
                      value={confirmation}
                      onChangeText={setConfirmation}
                    />
                    <SettingsButton
                      block
                      label={
                        mode === "merge"
                          ? `Merge into @${kept?.username}`
                          : `Delete other account and keep @${kept?.username}`
                      }
                      tone={mode === "discard" ? "danger" : "primary"}
                      loading={busy}
                      disabled={!ready}
                      onPress={async () => {
                        setBusy(true);
                        setErrorMessage("");
                        try {
                          await requestResolution(id, {
                            action: "resolve",
                            confirmation,
                            keepUserId: keepId,
                            mode,
                          });
                          setComplete(true);
                        } catch (error) {
                          setErrorMessage(
                            error instanceof Error
                              ? error.message
                              : "Could not resolve accounts."
                          );
                        }
                        setBusy(false);
                      }}
                    />
                  </>
                ) : (
                  <>
                    <SettingsButton
                      block
                      label={`Merge into @${kept?.username}`}
                      leadingIcon={GitMerge}
                      tone="gray"
                      disabled={Boolean(mergeReason)}
                      onPress={() => setMode("merge")}
                    />
                    {mergeReason && (
                      <Text style={{ color: theme.dividerText, fontSize: 12 }}>
                        {mergeReason}
                      </Text>
                    )}
                    <SettingsButton
                      block
                      label={`Delete @${lost?.username}, keep @${kept?.username}`}
                      leadingIcon={Trash2}
                      tone="danger"
                      disabled={Boolean(discardReason)}
                      onPress={() => setMode("discard")}
                    />
                    {discardReason && (
                      <Text style={{ color: theme.dividerText, fontSize: 12 }}>
                        {discardReason}
                      </Text>
                    )}
                  </>
                )}
                <SettingsButton
                  block
                  label="Cancel — keep both accounts"
                  tone="gray"
                  disabled={busy}
                  onPress={cancel}
                />
              </>
            )}
            {errorMessage ? (
              <Text
                accessibilityRole="alert"
                selectable
                style={{ color: theme.errorBannerText, fontSize: 12 }}
              >
                {errorMessage}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </DialogPanel>
  );
}
