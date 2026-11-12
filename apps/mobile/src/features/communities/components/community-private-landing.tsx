// Web's `components/communities/page/community-private-landing.tsx`.
//
// A PRIVATE community the viewer cannot read answers 404 from the detail route,
// so the screen falls back to the public preview and renders this instead of
// the feed: the community's identity on top, then the members-only card with
// the request / pending / banned states. The preview is re-read on focus, on
// app foreground and every 30s while a request is pending, and the moment it
// reports `canReadContent` the screen is asked to reload the real community.
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "expo-router";
import { Clock3, LockKeyhole } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { toast } from "@/components/feedback/toast";
import { ZephLoader } from "@/components/feedback/zeph-loader";
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  ORANGE_BUTTON_SHADOWS,
  ORANGE_DISABLED_GRADIENT,
  ORANGE_GRADIENT,
  ORANGE_PRESSED_GRADIENT,
  themeText,
} from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { formatNumber } from "@/lib/format/format-number";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK, useAppTheme } from "@/theme";

import {
  cancelCommunityRequest,
  fetchCommunityPreview,
  joinCommunity,
} from "../lib/communities-api";
import type {
  CommunityMutationResult,
  CommunityPreview,
} from "../lib/communities-api";
import { resolveCommunityAccentColor } from "../lib/community-accents";
import { communityMediaUrl } from "../lib/community-page-cache";
import {
  PRIVATE_LANDING_REFRESH_ERROR,
  previewPollInterval,
  privateLandingView,
} from "../lib/community-private-access";
import { CommunityAvatar } from "./community-avatar";

// `bg-muted` light + dark from packages/ui/styles/globals.css.
const MUTED_LIGHT = "#efefef";
const MUTED_DARK = "#262626";

export function CommunityPrivateLanding({
  bottomPadding,
  initialPreview,
  isLoggedIn,
  onAccessGranted,
  onRequireLogin,
}: {
  bottomPadding: number;
  initialPreview: CommunityPreview;
  isLoggedIn: boolean;
  onAccessGranted: () => void;
  onRequireLogin: () => void;
}) {
  const { isDark, theme } = useAppTheme();
  const text = themeText(isDark);
  const muted = isDark ? MUTED_DARK : MUTED_LIGHT;
  const { runWithInstallToken } = useInstall();
  const { slug } = initialPreview.community;
  const [preview, setPreview] = useState(initialPreview);
  const [queryError, setQueryError] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const alive = useRef(true);
  const latestRead = useRef(0);
  const skipFirstFocus = useRef(true);
  const onAccessGrantedRef = useRef(onAccessGranted);

  useEffect(() => {
    onAccessGrantedRef.current = onAccessGranted;
  }, [onAccessGranted]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Only the newest read may write, so a slow poll cannot overwrite the state a
  // later request already brought back.
  const refetch = useCallback(async () => {
    latestRead.current += 1;
    const readId = latestRead.current;
    setFetching(true);
    try {
      const next = await fetchCommunityPreview(slug, {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      });
      if (!alive.current || readId !== latestRead.current) {
        return;
      }
      setFetching(false);
      if (next) {
        setPreview(next);
        setQueryError(false);
      } else {
        setQueryError(true);
      }
    } catch {
      if (alive.current && readId === latestRead.current) {
        setFetching(false);
        setQueryError(true);
      }
    }
  }, [slug]);

  // Web's `refetchOnWindowFocus: "always"`. The screen has just read the
  // preview when this mounts, so the first focus is skipped rather than
  // repeating that request.
  useFocusEffect(
    useCallback(() => {
      if (skipFirstFocus.current) {
        skipFirstFocus.current = false;
        return;
      }
      void refetch();
    }, [refetch])
  );

  // The app returning to the foreground is native's window focus.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refetch();
      }
    });
    return () => subscription.remove();
  }, [refetch]);

  // Poll only while a request is pending, the screen is focused and the app is
  // in the foreground, matching web's `refetchIntervalInBackground: false`.
  const pollMs = previewPollInterval(preview);
  useFocusEffect(
    useCallback(() => {
      if (pollMs === null) {
        return;
      }
      const timer = setInterval(() => {
        if (AppState.currentState === "active") {
          void refetch();
        }
      }, pollMs);
      return () => clearInterval(timer);
    }, [pollMs, refetch])
  );

  const { canReadContent } = preview.permissions;
  useEffect(() => {
    if (canReadContent) {
      onAccessGrantedRef.current();
    }
  }, [canReadContent]);

  const updateRequest = async (cancel: boolean) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setMutationError(null);
    // Null means the viewer dismissed the install gate: nothing was sent, so
    // there is nothing to report.
    let result: CommunityMutationResult | null;
    try {
      result = await runWithInstallToken(
        async () => {
          const options = {
            apiBase: getApiBaseUrl(),
            cookie: await authClient.getCookie(),
          };
          return cancel
            ? cancelCommunityRequest(slug, options)
            : joinCommunity(slug, options);
        },
        (value) => value.kind === "install-token-required"
      );
    } catch {
      result = {
        kind: "error",
        message: "Couldn't update your request",
        status: 0,
      };
    }
    if (!alive.current) {
      return;
    }
    if (result?.kind === "success") {
      await refetch();
      if (!cancel && result.state.status === "PENDING") {
        toast({
          description: "You'll join once a moderator approves",
          title: "Requested",
        });
      }
    } else if (result?.kind === "error") {
      setMutationError(result.message);
    }
    if (alive.current) {
      setBusy(false);
    }
  };

  const view = privateLandingView({ busy, isLoggedIn, preview });
  const { community } = preview;
  const apiBase = getApiBaseUrl();
  const banner = communityMediaUrl(community.bannerUrl, apiBase);
  const errorMessage =
    mutationError ?? (queryError ? PRIVATE_LANDING_REFRESH_ERROR : null);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      style={styles.root}
    >
      <View
        style={[
          styles.banner,
          {
            backgroundColor: `${resolveCommunityAccentColor(community.accentColor, isDark)}38`,
          },
        ]}
      >
        {banner ? (
          <Image
            contentFit="cover"
            source={{ uri: banner }}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <LinearGradient
          colors={["transparent", theme.containerBg]}
          style={styles.bannerFade}
        />
      </View>
      <View style={styles.identity}>
        <View style={styles.avatar}>
          <CommunityAvatar community={community} size={64} />
        </View>
        <Text style={[styles.name, { color: theme.inputText }]}>
          {community.name}
        </Text>
        <Text style={[styles.meta, { color: theme.dividerText }]}>
          a/{community.slug} · {formatNumber(community.memberCount)}{" "}
          {community.memberCount === 1 ? "member" : "members"}
        </Text>
      </View>
      <View
        accessibilityState={{ busy }}
        style={[
          styles.card,
          {
            backgroundColor: theme.backgroundAlt,
            borderColor: theme.cardBorder,
            boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
          },
        ]}
      >
        <View style={styles.badgeRow}>
          <View style={[styles.lockCircle, { backgroundColor: muted }]}>
            <LockKeyhole color={text.muted} size={16} />
          </View>
          <Text style={[styles.badgeText, { color: text.muted }]}>
            Members only
          </Text>
        </View>
        <Text
          accessibilityRole="header"
          style={[styles.heading, { color: text.foreground }]}
        >
          Posts are for members of this community.
        </Text>
        <Text style={[styles.description, { color: text.muted }]}>
          {view.description}
        </Text>
        {view.mode === "banned" ? null : (
          <View style={styles.actions}>
            {view.mode === "pending" ? (
              <View style={styles.pendingStack}>
                <View
                  accessibilityLiveRegion="polite"
                  style={[styles.pendingPill, { backgroundColor: muted }]}
                >
                  <Clock3 color={text.foreground} size={16} />
                  <Text
                    style={[styles.pendingText, { color: text.foreground }]}
                  >
                    Request pending
                  </Text>
                </View>
                <Text style={[styles.note, { color: text.muted }]}>
                  We’ll notify you when there’s a decision. You can leave this
                  page while you wait.
                </Text>
                <GhostButton
                  disabled={busy}
                  label={view.cancelLabel}
                  muted={muted}
                  onPress={() => {
                    void updateRequest(true);
                  }}
                  textColor={text.foreground}
                />
              </View>
            ) : (
              <Pressable
                accessibilityHint={view.description}
                accessibilityLabel={view.requestLabel}
                accessibilityRole="button"
                accessibilityState={{ busy, disabled: busy }}
                disabled={busy}
                onPress={() => {
                  if (isLoggedIn) {
                    void updateRequest(false);
                  } else {
                    onRequireLogin();
                  }
                }}
              >
                {({ pressed }) => {
                  let colors: readonly [string, string] = ORANGE_GRADIENT;
                  if (busy) {
                    colors = ORANGE_DISABLED_GRADIENT;
                  } else if (pressed) {
                    colors = ORANGE_PRESSED_GRADIENT;
                  }
                  return (
                    <Gradient3D
                      colors={colors}
                      radius={9999}
                      shadows={ORANGE_BUTTON_SHADOWS}
                      style={[
                        styles.primary,
                        pressed && !busy && styles.pressed,
                      ]}
                    >
                      {busy ? (
                        <ZephLoader
                          accessibilityElementsHidden
                          importantForAccessibility="no-hide-descendants"
                          size={20}
                        />
                      ) : null}
                      <Text style={styles.primaryText}>
                        {view.requestLabel}
                      </Text>
                    </Gradient3D>
                  );
                }}
              </Pressable>
            )}
          </View>
        )}
        {errorMessage ? (
          <View style={styles.errorBlock}>
            <Text
              accessibilityRole="alert"
              style={[styles.errorText, { color: text.destructive }]}
            >
              {errorMessage}
            </Text>
            {queryError ? (
              <GhostButton
                disabled={fetching}
                label="Retry"
                muted={muted}
                onPress={() => {
                  void refetch();
                }}
                style={styles.retry}
                textColor={text.foreground}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

// Web's `variant="ghost"` Button at min-h-11 rounded-full: no surface at rest,
// a muted wash while pressed.
function GhostButton({
  disabled,
  label,
  muted,
  onPress,
  style,
  textColor,
}: {
  disabled: boolean;
  label: string;
  muted: string;
  onPress: () => void;
  style?: object;
  textColor: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.ghost,
        {
          backgroundColor: pressed ? muted : "transparent",
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      <Text style={[styles.ghostText, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: { marginTop: 20 },
  avatar: { marginTop: -32 },
  badgeRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  badgeText: { fontFamily: "SofiaProMed", fontSize: 12 },
  banner: { height: 144, overflow: "hidden" },
  bannerFade: {
    bottom: 0,
    height: 64,
    left: 0,
    position: "absolute",
    right: 0,
  },
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 20,
  },
  description: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 22,
    marginTop: 8,
  },
  errorBlock: { marginTop: 12 },
  errorText: { fontFamily: "SofiaProReg", fontSize: 14, lineHeight: 22 },
  ghost: {
    alignItems: "center",
    borderRadius: 9999,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  ghostText: { fontFamily: "SofiaProMed", fontSize: 14 },
  heading: {
    fontFamily: "SofiaProBold",
    fontSize: 18,
    lineHeight: 24,
    maxWidth: 384,
  },
  identity: { paddingBottom: 16, paddingHorizontal: 16 },
  lockCircle: {
    alignItems: "center",
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  meta: { fontFamily: "SofiaProReg", fontSize: 14 },
  name: { fontFamily: "SofiaProBold", fontSize: 20, marginTop: 12 },
  note: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 19 },
  pendingPill: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  pendingStack: { gap: 12 },
  pendingText: { fontFamily: "SofiaProMed", fontSize: 14 },
  pressed: { transform: [{ translateY: 1 }] },
  primary: {
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  primaryText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    letterSpacing: -0.2,
    textShadowColor: "rgba(0, 0, 0, 0.2)",
    textShadowOffset: { height: 1, width: 0 },
  },
  retry: { marginTop: 8 },
  root: { flex: 1 },
});
