// Force-update gate. Runs ONCE on app launch (event-driven, no polling):
// fetches the GitHub releases list, finds the newest release that actually
// ships an APK, and blocks the app when the APK is newer than the running
// build. Older versions are unsupported, so the modal has no dismiss —
// only "Update app", which downloads the APK and opens the installer.
// Skipped in dev and on non-Android (no sideload path there). A failed
// CHECK (offline) lets the user in and only logs; a confirmed newer
// version always blocks.
import * as Application from "expo-application";
import Constants from "expo-constants";
import { Directory, File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AuthPrimaryButton } from "@/features/auth/components/auth-primary-button";
import {
  GITHUB_REPO_DEFAULT,
  findLatestApkRelease,
  githubReleasesUrl,
  isTrustedApkUrl,
  isUpdateRequired,
  parseReleases,
} from "@/features/update/lib/update-check";
import { logError, logInfo, logWarn } from "@/lib/telemetry";
import { ERROR_SHADOWS, useAppTheme } from "@/theme";

type GateState =
  | { status: "checking" }
  | { status: "current" }
  | { assetName: string; assetUrl: string; status: "update"; version: string }
  | { progress: number; status: "downloading"; version: string }
  | { status: "failed"; message: string };

function getCurrentVersion(): string | null {
  return (
    Application.nativeApplicationVersion ??
    Constants.expoConfig?.version ??
    null
  );
}

const UPDATE_CHECK_ENABLED = !__DEV__ && Platform.OS === "android";

// A download that stops delivering bytes should not hang the gate forever;
// abort once nothing has arrived for this long.
const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 60_000;

export function UpdateGate() {
  const { theme } = useAppTheme();
  const [state, setState] = useState<GateState>(() =>
    UPDATE_CHECK_ENABLED ? { status: "checking" } : { status: "current" }
  );

  // Note: callers set { status: "checking" } before invoking (event
  // handlers and lazy init), so this body never synchronously sets state
  // on the mount-effect path.
  const checkForUpdate = useCallback(async () => {
    try {
      const repo =
        process.env.EXPO_PUBLIC_GITHUB_REPO?.trim() || GITHUB_REPO_DEFAULT;
      const response = await fetch(githubReleasesUrl(repo), {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) {
        logWarn("update.check_failed", { status: response.status });
        setState({ status: "current" });
        return;
      }
      const releases = parseReleases(await response.json());
      const latest = findLatestApkRelease(releases);
      const current = getCurrentVersion();
      logInfo("update.check", {
        current: current ?? "unknown",
        latest: latest?.version ?? "none",
      });
      if (
        latest &&
        isTrustedApkUrl(latest.asset.browser_download_url, repo) &&
        isUpdateRequired(current, latest.version)
      ) {
        setState({
          assetName: latest.asset.name,
          assetUrl: latest.asset.browser_download_url,
          status: "update",
          version: latest.version,
        });
        return;
      }
      if (latest && !isTrustedApkUrl(latest.asset.browser_download_url, repo)) {
        // Refuse to point the installer at anything outside this repo's
        // releases; treat it as "no update" rather than trusting the URL.
        logWarn("update.untrusted_asset_url", { repo });
      }
      setState({ status: "current" });
    } catch (error) {
      // Offline or API hiccup: log and let the user in. A confirmed newer
      // version still blocks; an unknown state does not brick the app.
      logWarn("update.check_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
      setState({ status: "current" });
    }
  }, []);

  useEffect(() => {
    if (UPDATE_CHECK_ENABLED) {
      // oxlint-disable-next-line react/set-state-in-effect -- the launch check is a network fetch that can only run after mount; nothing to derive during render.
      void checkForUpdate();
    }
  }, [checkForUpdate]);

  const handleUpdate = useCallback(async () => {
    if (state.status !== "update" && state.status !== "failed") {
      return;
    }
    const assetUrl = state.status === "update" ? state.assetUrl : null;
    const assetName = state.status === "update" ? state.assetName : null;
    const version = state.status === "update" ? state.version : "latest";
    if (!assetUrl || !assetName) {
      setState({ status: "checking" });
      void checkForUpdate();
      return;
    }
    const controller = new AbortController();
    let inactivity: ReturnType<typeof setTimeout> | null = null;
    const armInactivity = () => {
      if (inactivity) {
        clearTimeout(inactivity);
      }
      inactivity = setTimeout(
        () => controller.abort(),
        DOWNLOAD_INACTIVITY_TIMEOUT_MS
      );
    };
    try {
      setState({ progress: 0, status: "downloading", version });
      logInfo("update.download_start", { version });
      armInactivity();
      const file = await File.downloadFileAsync(
        assetUrl,
        new File(new Directory(Paths.cache), assetName),
        {
          idempotent: true,
          onProgress: ({ bytesWritten, totalBytes }) => {
            // Bytes arriving means the transfer is alive, so restart the window.
            armInactivity();
            if (totalBytes > 0) {
              setState({
                progress: bytesWritten / totalBytes,
                status: "downloading",
                version,
              });
            }
          },
          signal: controller.signal,
        }
      );
      // The download is done, so the inactivity window no longer applies.
      // Cleared here (not in a `finally`) because the React Compiler rejects
      // try/finally.
      if (inactivity) {
        clearTimeout(inactivity);
        inactivity = null;
      }
      const { contentUri } = file;
      logInfo("update.download_done", { version });
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        flags: 1,
        type: "application/vnd.android.package-archive",
      });
    } catch (error) {
      if (inactivity) {
        clearTimeout(inactivity);
        inactivity = null;
      }
      logError("update.download_failed", error, { version });
      setState({
        message:
          "Couldn't download the update. Check your connection and try again.",
        status: "failed",
      });
    }
  }, [checkForUpdate, state]);

  if (state.status === "checking" || state.status === "current") {
    return null;
  }

  return (
    <Modal animationType="fade" transparent visible>
      <View style={[styles.overlay, { backgroundColor: "rgba(0, 0, 0, 0.7)" }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.cardBg,
              borderColor: theme.cardBorder,
              shadowColor: theme.cardShadow,
            },
          ]}
        >
          <Text style={[styles.title, { color: "#ff9500" }]}>
            Update required
          </Text>
          <Text style={[styles.body, { color: theme.dividerText }]}>
            {state.status === "downloading"
              ? `Downloading v${state.version}…`
              : "This version of asocialmedia is no longer supported. Update to the latest version to continue."}
          </Text>
          {state.status === "update" ? (
            <Text style={[styles.version, { color: theme.inputLabel }]}>
              v{state.version} available
            </Text>
          ) : null}
          {state.status === "downloading" ? (
            <View style={styles.progressRow}>
              <View
                style={[styles.track, { backgroundColor: theme.dividerLine }]}
              >
                <View
                  style={[
                    styles.fill,
                    { width: `${Math.round(state.progress * 100)}%` },
                  ]}
                />
              </View>
              <Text style={[styles.percent, { color: theme.inputLabel }]}>
                {Math.round(state.progress * 100)}%
              </Text>
            </View>
          ) : null}
          {state.status === "failed" ? (
            <View
              style={[
                styles.errorBox,
                {
                  backgroundColor: theme.errorBannerBg,
                  boxShadow: ERROR_SHADOWS,
                },
              ]}
            >
              <Text
                style={[styles.errorText, { color: theme.errorBannerText }]}
              >
                {state.message}
              </Text>
            </View>
          ) : null}
          {state.status === "downloading" ? (
            <ActivityIndicator color="#ff9500" size="small" />
          ) : (
            <AuthPrimaryButton
              label={state.status === "failed" ? "Try again" : "Update app"}
              onPress={() => {
                void handleUpdate();
              }}
            />
          )}
          {state.status === "failed" ? (
            <Pressable
              hitSlop={6}
              onPress={() => {
                setState({ status: "checking" });
                void checkForUpdate();
              }}
              style={styles.retryRow}
            >
              <Text style={[styles.retryText, { color: theme.auxLink }]}>
                Check again
              </Text>
            </Pressable>
          ) : null}
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
    gap: 12,
    maxWidth: 340,
    padding: 20,
    width: "100%",
  },
  errorBox: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
    textAlign: "center",
  },
  fill: {
    backgroundColor: "#ff9500",
    borderRadius: 9999,
    height: "100%",
  },
  overlay: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  percent: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
  },
  progressRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
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
  track: {
    borderRadius: 9999,
    flex: 1,
    height: 8,
    overflow: "hidden",
  },
  version: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
    textAlign: "center",
  },
});
