// Support-floor gate. Runs ONCE on launch, event-driven, no polling: asks the
// server whether the build it is running is still served, and blocks the app
// when the answer is no.
//
// This replaced an earlier gate that downloaded the release APK and launched the
// system installer. That needed the REQUEST_INSTALL_PACKAGES permission and is
// forbidden by Play Store policy, so it was removed - and with it went the only
// thing that ever told a stale installation it was stale. A released build does
// not update itself: a sideloaded APK, a Play Store install the user has not
// updated, or a device that has been offline for a month all keep running the
// build they have. So the check comes back, with the update itself handed to
// whatever store or release page the user installed from. Nothing is fetched or
// installed by the app.
//
// Three rules, all of them about not bricking the app:
//  - a CHECK that fails (offline, bad gateway, unparseable) lets the user in and
//    only logs; only a confirmed answer below the floor blocks;
//  - a floor that does not parse is treated as no floor at all, so a typo in a
//    server-side variable cannot lock out every installed copy;
//  - the modal has no dismiss - a build the server no longer serves must not be
//    usable - but "Update" is the only action, and it opens a browser rather than
//    installing anything.
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { toast } from "@/components/feedback/toast";
import { AuthPrimaryButton } from "@/features/auth/components/auth-primary-button";
import { getApiBaseUrl } from "@/lib/api-env";
import { logInfo, logWarn } from "@/lib/telemetry";
import {
  ERROR_SHADOWS,
  SURFACE_SHADOWS,
  SURFACE_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

import { fetchSupportPolicy } from "../lib/support-api";
import {
  evaluateSupport,
  nextSupportState,
  parseVersion,
} from "../lib/support-policy";
import type { SupportCheck, SupportGateState } from "../lib/support-policy";

// Dev builds are always current by definition: they are the source the next
// release is cut from, and blocking one on a stale floor would stop a developer
// dead. Only a shipped binary can be out of support.
const SUPPORT_CHECK_ENABLED = !__DEV__;

// The verdict shape and its one transition rule live in ../lib/support-policy,
// as pure functions: "an inconclusive check never moves the verdict" is the
// whole safety argument of this gate, and it has to be testable without a
// renderer.

function currentBuildVersion(): string | null {
  return (
    Application.nativeApplicationVersion ??
    Constants.expoConfig?.version ??
    null
  );
}

// Where an out-of-support build sends the user. One override, because the right
// destination differs by how the app was installed and only a build-time value
// can know that; the release page is the safe default, since it is where a
// sideloaded install came from and is a valid fallback for everyone else.
function updateUrl(): string {
  const configured = process.env.EXPO_PUBLIC_MOBILE_UPDATE_URL?.trim();
  if (configured) {
    return configured;
  }
  const repo =
    process.env.EXPO_PUBLIC_GITHUB_REPO?.trim() || "asocialmedia/social";
  return `https://github.com/${repo}/releases/latest`;
}

export function SupportGate() {
  const { isDark, theme } = useAppTheme();
  const [state, setState] = useState<SupportGateState>({ status: "current" });
  // Only ever read while the gate is open, to explain why "Check again" appears
  // to do nothing. It can never be what blocks a build on its own.
  const [unreachable, setUnreachable] = useState(false);

  // Note: callers set a state before invoking; this body never synchronously
  // sets state on the mount-effect path.
  //
  // An INCONCLUSIVE check must never move the verdict; only a completed one
  // may. That matters most on the retry path. The server has already said this
  // build is unsupported, and a "Check again" that cannot reach the server - or
  // gets a body it cannot read - says nothing about whether that is still true.
  // Treating that silence as an answer used to let the one build we know is
  // retired walk straight back in, which defeats the entire gate. So a failed
  // check returns without touching the state at all, which leaves the gate
  // exactly as it was: closed if this build was never retired, open if it was.
  const checkSupport = useCallback(async () => {
    let check: SupportCheck;
    try {
      check = await fetchSupportPolicy({ apiBase: getApiBaseUrl() });
    } catch (error) {
      logWarn("support.check_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
      setUnreachable(true);
      return;
    }
    if (!check.ok) {
      logWarn("support.check_unreachable", {});
      setUnreachable(true);
      return;
    }
    setUnreachable(false);
    const version = currentBuildVersion();
    logInfo("support.check", {
      build: version ?? "unknown",
      floor: check.policy.minimumSupported ?? "none",
      verdict: evaluateSupport(version, check.policy),
    });
    // nextSupportState leaves the state untouched when the check did not
    // complete, so a failed retry cannot close a gate the server already put up.
    setState((previous) => nextSupportState(previous, check, version));
  }, []);

  useEffect(() => {
    if (SUPPORT_CHECK_ENABLED) {
      // oxlint-disable-next-line react/set-state-in-effect -- the launch check is a network fetch that can only run after mount; nothing to derive during render.
      void checkSupport();
    }
  }, [checkSupport]);

  const openUpdate = useCallback(async () => {
    const url = updateUrl();
    try {
      await Linking.openURL(url);
    } catch {
      toast({
        description: url,
        title: "Open your browser to update",
      });
    }
  }, []);

  if (state.status !== "unsupported") {
    return null;
  }

  const floor = state.currentVersion
    ? parseVersion(state.currentVersion)
    : null;
  return (
    <Modal animationType="fade" transparent visible>
      <View
        style={[styles.overlay, { backgroundColor: "rgba(0, 0, 0, 0.72)" }]}
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.cardBg,
              borderColor: theme.cardBorder,
              boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
            },
          ]}
        >
          <Text style={[styles.title, { color: "#ff9500" }]}>
            Update required
          </Text>
          <Text style={[styles.body, { color: theme.dividerText }]}>
            This version of asocialmedia is no longer supported. Update to
            continue.
          </Text>
          <View
            style={[
              styles.note,
              {
                backgroundColor: theme.errorBannerBg,
                boxShadow: ERROR_SHADOWS,
              },
            ]}
          >
            <Text style={[styles.noteText, { color: theme.errorBannerText }]}>
              {floor
                ? `You are on v${floor}. Open the latest release to update.`
                : "Open the latest release to update."}
            </Text>
          </View>
          <AuthPrimaryButton
            label="Update app"
            onPress={() => {
              void openUpdate();
            }}
          />
          {/* Only after a retry that could not reach the server, so the tap does
              not look broken. The gate deliberately stays open either way. */}
          {unreachable ? (
            <Text style={[styles.unreachable, { color: theme.dividerText }]}>
              Couldn&apos;t reach the server. This version is still unsupported.
            </Text>
          ) : null}
          <Pressable
            hitSlop={6}
            onPress={() => {
              void checkSupport();
            }}
            style={styles.retryRow}
          >
            <Text style={[styles.retryText, { color: theme.auxLink }]}>
              Check again
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
    textAlign: "center",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 14,
    maxWidth: 340,
    padding: 20,
    width: "100%",
  },
  note: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  noteText: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
    textAlign: "center",
  },
  overlay: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  retryRow: {
    alignItems: "center",
  },
  retryText: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
  title: {
    fontFamily: "SofiaProBold",
    fontSize: 22,
    fontWeight: "normal",
    textAlign: "center",
  },
  unreachable: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    textAlign: "center",
  },
});
