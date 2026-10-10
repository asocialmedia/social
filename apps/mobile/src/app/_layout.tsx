import { useFonts } from "expo-font";

import "../global.css";
import { NavigationBar } from "expo-navigation-bar";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useReducedMotion } from "react-native-reanimated";
import { enableFreeze } from "react-native-screens";

import { ErrorBoundary } from "@/components/feedback/error-boundary";
import { StartupGate } from "@/components/feedback/startup-splash";
import { Toaster } from "@/components/feedback/toast";
import { InstallVerificationGate } from "@/features/auth/components/install-verification-gate";
import { SessionRevocationGuard } from "@/features/auth/components/session-revocation-guard";
import { InstallProvider } from "@/features/auth/state/install";
import { SessionProvider } from "@/features/auth/state/session";
import { MediaPreviewLauncher } from "@/features/feed/components/media-preview-launcher";
import { PushRegistrar } from "@/features/notifications/components/push-registrar";
import { getApiBaseUrl } from "@/lib/api-env";
import { loadInstallToken } from "@/lib/install-credentials";
import { installFetchInterceptor } from "@/lib/install-fetch";
import { finishPostEnter, postEnterAnimation } from "@/lib/navigation-motion";
import { ResumeGate, ResumeSaver } from "@/lib/resume-gate";
import { StartupPresentedContext } from "@/lib/startup-context";
import { prepareNativeStartup } from "@/lib/startup-native";
import { initTelemetry } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

import sofiaProBold from "../../assets/fonts/SofiaProSoftBold.ttf";
import sofiaProMed from "../../assets/fonts/SofiaProSoftMed.ttf";
import sofiaProReg from "../../assets/fonts/SofiaProSoftReg.ttf";

// Defer module evaluation as well as mounting. These overlays are not needed
// to display the restored screen and otherwise load their dependencies at boot.
const ComposerModal = lazy(async () => {
  const composerModule =
    await import("@/features/composer/components/composer-modal");
  return { default: composerModule.ComposerModal };
});
const SpotlightModal = lazy(async () => {
  const searchModule =
    await import("@/features/search/components/spotlight-modal");
  return { default: searchModule.SpotlightModal };
});
const UnreadMessageObserver = lazy(async () => {
  const observerModule =
    await import("@/features/messages/state/unread-message-observer");
  return { default: observerModule.UnreadMessageObserver };
});
const SupportGate = lazy(async () => {
  const supportModule =
    await import("@/features/support/components/support-gate");
  return { default: supportModule.SupportGate };
});

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 180, fade: true });
// Freeze off-screen native screens so backgrounded routes stop re-rendering
// while the foreground animates. Best-effort: never break launch.
try {
  enableFreeze(true);
} catch {
  // react-native-screens not ready; navigation still works unfrozen.
}

// Defers non-critical launch work past first paint. InteractionManager is
// deprecated in RN 0.86 (it warns on every launch), so this uses
// requestIdleCallback with a setTimeout fallback instead.
function runAfterIdle(work: () => void): () => void {
  const idle = (
    globalThis as unknown as {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (callback: () => void) => number;
    }
  ).requestIdleCallback;
  if (typeof idle === "function") {
    const handle = idle(work);
    return () => {
      (
        globalThis as unknown as {
          cancelIdleCallback?: (handle: number) => void;
        }
      ).cancelIdleCallback?.(handle);
    };
  }
  const timer = setTimeout(work, 0);
  return () => clearTimeout(timer);
}

export default function RootLayout() {
  const { isDark, theme } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const navigationAnimation =
    Platform.OS === "ios" ? "default" : "slide_from_right";

  const [loaded, error] = useFonts({
    SofiaPro: sofiaProReg,
    SofiaProBold: sofiaProBold,
    SofiaProMed: sofiaProMed,
    SofiaProReg: sofiaProReg,
    "SofiaProSoft-Bold": sofiaProBold,
    "SofiaProSoft-Medium": sofiaProMed,
    "SofiaProSoft-Regular": sofiaProReg,
  });

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.containerBg);
  }, [theme.containerBg]);

  // Non-critical init runs after the first paint so the bundle evaluates
  // and the navigator mounts before telemetry or SecureStore IO contend for
  // the JS thread. The fetch interceptor itself stays synchronous so no early
  // request escapes without it.
  useEffect(() => {
    installFetchInterceptor(getApiBaseUrl());
    return runAfterIdle(() => {
      initTelemetry();
      void loadInstallToken();
    });
  }, []);

  const [localReady, setLocalReady] = useState(false);
  const [fontFallback, setFontFallback] = useState(false);
  const [routeReady, setRouteReady] = useState(false);
  const [presented, setPresented] = useState(false);
  const markRouteReady = useCallback(() => setRouteReady(true), []);
  const markPresented = useCallback(() => setPresented(true), []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await prepareNativeStartup();
      if (!cancelled) {
        setLocalReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (loaded || error) {
      return;
    }
    const timer = setTimeout(() => setFontFallback(true), 2500);
    return () => clearTimeout(timer);
  }, [error, loaded]);

  // Mount non-critical overlays only after the actual startup handoff.
  const [deferredReady, setDeferredReady] = useState(false);
  useEffect(() => {
    if (!presented) {
      return;
    }
    return runAfterIdle(() => setDeferredReady(true));
  }, [presented]);

  if (!localReady || (!loaded && !error && !fontFallback)) {
    return null;
  }

  // Gesture-handler root: native gestures (the feed's Android pull) need it
  // above every screen.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Outermost boundary: a throw anywhere below, including a provider or
          the navigator itself, lands on a screen with a working Try Again
          instead of a blank window. */}
      <ErrorBoundary>
        <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
          <StatusBar style={isDark ? "light" : "dark"} />
          {/* Keep an explicit base entry so immersive routes restore the bar on blur. */}
          <NavigationBar hidden={false} style={isDark ? "light" : "dark"} />
          {/* Install credential first: the session provider wraps every mutating
            auth call in it, so a fresh install is verified before signing in. */}
          <InstallProvider>
            <SessionProvider>
              <StartupPresentedContext.Provider value={presented}>
                <ResumeGate onReady={markRouteReady} />
                <ResumeSaver />
                {/* Launch-time support check. The app it replaced downloaded a
                release APK and launched the system installer, which Play Store
                policy forbids; this asks the server whether the running build is
                still served and hands an out-of-date one to the store. Inside
                the session provider so the check shares the API base. Deferred
                past first paint: it is not needed to show cached content. */}
                <Suspense fallback={null}>
                  {deferredReady ? <SupportGate /> : null}
                  {deferredReady ? <UnreadMessageObserver /> : null}
                </Suspense>
                {/* Native push registration + tap routing. Inside the session
                provider so it can react to sign-in/out. */}
                <PushRegistrar />
                {/* Real-time session revocation listener (SSE stream). Terminates
                the local session immediately if revoked remotely or on 401. */}
                <SessionRevocationGuard />
                <Stack
                  screenOptions={{
                    animation: presented ? navigationAnimation : "none",
                    // Keep later page transitions short; the restored route
                    // itself is committed without animation beneath the splash.
                    animationDuration: 200,
                    contentStyle: { backgroundColor: theme.containerBg },
                    // Frozen off-screen routes stop re-rendering while the
                    // foreground animates, which is the main home-to-profile
                    // jank source on low-end Android.
                    freezeOnBlur: true,
                    headerShown: false,
                  }}
                >
                  <Stack.Screen name="index" options={{ animation: "none" }} />
                  <Stack.Screen
                    name="posts"
                    options={{ animation: postEnterAnimation(presented) }}
                    listeners={({ navigation }) => ({
                      transitionEnd: (event) => {
                        finishPostEnter(
                          navigation.setOptions,
                          event.data.closing,
                          Platform.OS,
                          reducedMotion
                        );
                      },
                    })}
                  />
                  <Stack.Screen name="notifications" />
                  <Stack.Screen name="bookmarks" />
                  {/* Messages is a nested stack of its own (see messages/_layout.tsx):
                    the conversation list, then one thread per conversation. Only
                    the group is registered here -- the thread lives inside that
                    layout, so naming it at this level would match no child. */}
                  <Stack.Screen name="messages" />
                  <Stack.Screen
                    name="gusts"
                    options={{
                      animation: "fade_from_bottom",
                      animationDuration: 250,
                      contentStyle: { backgroundColor: "#000000" },
                      presentation: "fullScreenModal",
                    }}
                  />
                  <Stack.Screen
                    name="users/[username]"
                    options={{ animationDuration: 200 }}
                  />
                  <Stack.Screen name="users/[username]/followers" />
                  <Stack.Screen name="users/[username]/following" />
                  <Stack.Screen name="discover" />
                  <Stack.Screen name="communities" />
                  <Stack.Screen
                    name="communities/create"
                    options={{
                      animation: "slide_from_bottom",
                      presentation: "modal",
                    }}
                  />
                  <Stack.Screen name="a/[slug]" />
                  <Stack.Screen name="legal/[document]" />
                  <Stack.Screen name="hashtag/[tag]" />
                  <Stack.Screen name="hackernews" />
                  <Stack.Screen name="settings" />
                  <Stack.Screen
                    name="(auth)"
                    options={{
                      animation: "fade",
                      animationDuration: 200,
                    }}
                  />
                </Stack>
                {/* Shown only when a mutating request needs the install credential
                and none is stored yet, so browsing never pays the cost. */}
                <InstallVerificationGate
                  sitekey={process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY}
                />
                {/* The post composer (opened from the dock's + and Respond) and
                  the app-wide toast stack. Deferred past first paint. */}
                <Suspense fallback={null}>
                  {deferredReady ? <ComposerModal /> : null}
                </Suspense>
                {/* Floating spotlight search modal, matching web's SpotlightProvider. */}
                <Suspense fallback={null}>
                  {deferredReady ? <SpotlightModal /> : null}
                </Suspense>
                <MediaPreviewLauncher />
                <Toaster />
                <StartupGate ready={routeReady} onPresented={markPresented} />
              </StartupPresentedContext.Provider>
            </SessionProvider>
          </InstallProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
