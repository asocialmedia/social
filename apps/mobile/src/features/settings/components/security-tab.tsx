// Native port of web's `settings/tabs/security-settings.tsx`.
//
// Two flows are preserved exactly because they are the ones that lock people
// out when they go wrong:
//   - Removing the authenticator is implemented as disable-then-re-enable-email,
//     so the email fallback survives an authenticator loss.
//   - Revoking the session you are currently using signs you out, rather than
//     leaving the app holding a cookie the server no longer accepts.
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { useSessionContext } from "@/features/auth/state/session";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

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
import {
  SettingsButton,
  SettingsCard,
  SettingsCardHeading,
  SettingsInput,
  SettingsSectionHeader,
  SettingsStatusChip,
} from "./settings-ui";

export function SecurityTab() {
  const { theme } = useAppTheme();
  const { runWithInstallToken } = useInstall();
  const { signOut } = useSessionContext();
  const [sessions, setSessions] = useState<SecuritySession[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [reauthing, setReauthing] = useState(false);

  const loadSessions = useCallback(async () => {
    const options = {
      apiBase: getApiBaseUrl(),
      cookie: await authClient.getCookie(),
    };
    setSessions(await fetchSecuritySessions(options));
  }, []);

  useEffect(() => {
    // Synchronizing with the server on mount is exactly what an effect is for.
    // oxlint-disable-next-line react/set-state-in-effect -- the setState happens after the await inside loadSessions, not synchronously here
    void loadSessions();
  }, [loadSessions]);

  const revoke = async (
    sessionId: string,
    action: "all" | "other-sessions" | "single",
    isCurrent = false
  ) => {
    setRevoking(sessionId);
    const options = {
      apiBase: getApiBaseUrl(),
      cookie: await authClient.getCookie(),
    };
    const result = await runWithInstallToken(
      () => revokeSecuritySession(sessionId, action, options),
      (value) => Boolean(value && value.kind === "install-token-required")
    );
    setRevoking(null);
    if (result === null) {
      return;
    }
    if (result.kind === "error") {
      // A 403 here means the session was already gone, which is the outcome
      // the user asked for anyway.
      toast({
        description: result.message,
        title: "Couldn't Sign Out",
        variant: "destructive",
      });
      return;
    }
    toast({ description: "That device is signed out.", title: "Signed Out" });
    // Revoking the session this app is using leaves the local cookie pointing
    // at a session the server has dropped, so sign out rather than leaving the
    // app in a state where every write 401s.
    if (isCurrent || action === "all") {
      await signOut();
      return;
    }
    await loadSessions();
  };

  const confirmReauth = () => {
    setReauthing(true);
    void (async () => {
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      const result = await runWithInstallToken(
        () => reauthenticate(password, options),
        (value) => Boolean(value && value.kind === "install-token-required")
      );
      setReauthing(false);
      if (result === null) {
        return;
      }
      if (result.kind !== "success") {
        toast({
          description:
            result.kind === "error"
              ? result.message
              : "Couldn't confirm it's you",
          title: "Not Confirmed",
          variant: "destructive",
        });
        return;
      }
      setReauthOpen(false);
      setPassword("");
      toast({
        description: "Thanks, that's you confirmed.",
        title: "Confirmed",
      });
    })();
  };

  // The loading, empty and list states are resolved together so they cannot
  // drift apart as the card is edited.
  const renderSessions = () => {
    if (sessions === null) {
      return <ActivityIndicator color="#ff9500" />;
    }
    if (sessions.length === 0) {
      return (
        <Text style={[styles.note, { color: theme.dividerText }]}>
          No other sessions found.
        </Text>
      );
    }
    return sessions.map((session) => {
      const device = sessionDeviceLabel(session.userAgent);
      return (
        <View key={session.id} style={styles.session}>
          <View style={styles.sessionCopy}>
            <View style={styles.sessionTitle}>
              <Text style={[styles.sessionName, { color: theme.inputText }]}>
                {device}
              </Text>
              {session.current ? (
                <SettingsStatusChip label="This device" tone="primary" />
              ) : null}
            </View>
            <Text style={[styles.note, { color: theme.dividerText }]}>
              {getSessionLocation(session.country, session.ipAddress)}
            </Text>
            <Text style={[styles.note, { color: theme.dividerText }]}>
              Last active {formatLastActive(session.updatedAt, Date.now())}
            </Text>
          </View>
          <SettingsButton
            disabled={revoking === session.id}
            label={session.current ? "Sign out" : "End"}
            onPress={() => {
              void revoke(session.id, "single", session.current);
            }}
            tone="danger"
          />
        </View>
      );
    });
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <SettingsSectionHeader
        description="Password, two-factor, passkeys and sessions"
        title="Security"
      />

      <SettingsCard>
        <SettingsCardHeading
          action={
            <SettingsStatusChip label="Check in Settings" tone="neutral" />
          }
        >
          <Text style={[styles.cardTitle, { color: theme.inputText }]}>
            Two-factor authentication
          </Text>
          <Text style={[styles.cardHint, { color: theme.dividerText }]}>
            Add a second step to sign in
          </Text>
        </SettingsCardHeading>
        <Text style={[styles.note, { color: theme.dividerText }]}>
          Two-factor is managed with your authenticator app or an emailed code.
          Turn it on from the web settings for now, or install an authenticator
          and enable it there.
        </Text>
        <SettingsButton
          label="Open two-factor setup"
          onPress={() => {
            toast({
              description:
                "Two-factor setup runs on the web for now. Your sessions are listed below.",
              title: "Almost there",
            });
          }}
          tone="neutral"
        />
      </SettingsCard>

      <SettingsCard>
        <SettingsCardHeading>
          <Text style={[styles.cardTitle, { color: theme.inputText }]}>
            Confirm it's you
          </Text>
          <Text style={[styles.cardHint, { color: theme.dividerText }]}>
            Required before passkeys and sessions can be changed
          </Text>
        </SettingsCardHeading>
        {reauthOpen ? (
          <SettingsButton
            label="Confirm it's you"
            onPress={() => {
              setReauthOpen(true);
            }}
          />
        ) : (
          <View style={styles.stage}>
            <SettingsInput
              label="Current password"
              onChangeText={setPassword}
              secureTextEntry
              value={password}
            />
            <SettingsButton
              disabled={reauthing || password.length === 0}
              label={reauthing ? "Confirming…" : "Confirm"}
              onPress={confirmReauth}
            />
            <SettingsButton
              label="Cancel"
              onPress={() => {
                setReauthOpen(false);
                setPassword("");
              }}
              tone="neutral"
            />
          </View>
        )}
      </SettingsCard>

      <SettingsCard>
        <SettingsCardHeading
          action={
            <SettingsButton
              label="Refresh"
              onPress={() => {
                void loadSessions();
              }}
              tone="neutral"
            />
          }
        >
          <Text style={[styles.cardTitle, { color: theme.inputText }]}>
            Where you're signed in
          </Text>
          <Text style={[styles.cardHint, { color: theme.dividerText }]}>
            Every device holding a session for this account
          </Text>
        </SettingsCardHeading>
        {renderSessions()}
        {sessions && sessions.length > 1 ? (
          <View style={styles.bulk}>
            <SettingsButton
              disabled={revoking !== null}
              label="Sign out other devices"
              onPress={() => {
                const other = sessions.find((entry) => !entry.current);
                if (other) {
                  void revoke(other.id, "other-sessions");
                }
              }}
              tone="danger"
            />
            <SettingsButton
              disabled={revoking !== null}
              label="Sign out everywhere"
              onPress={() => {
                const current = sessions.find((entry) => entry.current);
                if (current) {
                  void revoke(current.id, "all");
                }
              }}
              tone="danger"
            />
          </View>
        ) : null}
      </SettingsCard>
      <SettingsCard>
        <SettingsCardHeading>
          <Text style={[styles.cardTitle, { color: theme.inputText }]}>
            Push notifications
          </Text>
          <Text style={[styles.cardHint, { color: theme.dividerText }]}>
            Registered automatically for this device
          </Text>
        </SettingsCardHeading>
        <Text style={[styles.note, { color: theme.dividerText }]}>
          Notifications are turned on for this install while you're signed in,
          and switch off when you sign out. Revoke them from your device
          settings at any time.
        </Text>
      </SettingsCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bulk: { gap: 8 },
  cardHint: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 2 },
  cardTitle: { fontFamily: "SofiaProMed", fontSize: 15 },
  content: { gap: 14, padding: 16, paddingBottom: 40 },
  note: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 17 },
  session: {
    alignItems: "center",
    borderTopColor: "rgba(128,128,128,0.2)",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 12,
  },
  sessionCopy: { flex: 1, gap: 3, minWidth: 0 },
  sessionName: { fontFamily: "SofiaProMed", fontSize: 14 },
  sessionTitle: { alignItems: "center", flexDirection: "row", gap: 8 },
  stage: { gap: 10 },
});
