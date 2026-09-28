import "../global.css";
import { useFonts } from "expo-font";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ErrorBoundary } from "@/components/feedback/error-boundary";
import { StartupGate } from "@/components/feedback/startup-splash";
import { Toaster } from "@/components/feedback/toast";
import { InstallVerificationGate } from "@/features/auth/components/install-verification-gate";
import { SessionRevocationGuard } from "@/features/auth/components/session-revocation-guard";
import { InstallProvider } from "@/features/auth/state/install";
import { SessionProvider } from "@/features/auth/state/session";
import { ComposerModal } from "@/features/composer/components/composer-modal";
import { PushRegistrar } from "@/features/notifications/components/push-registrar";
import { SpotlightModal } from "@/features/search/components/spotlight-modal";
import { getApiBaseUrl } from "@/lib/api-env";
import { loadInstallToken } from "@/lib/install-credentials";
import { installFetchInterceptor } from "@/lib/install-fetch";
import { initTelemetry } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

import sofiaProBold from "../../assets/fonts/SofiaProSoftBold.ttf";
import sofiaProMed from "../../assets/fonts/SofiaProSoftMed.ttf";
import sofiaProReg from "../../assets/fonts/SofiaProSoftReg.ttf";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { isDark, theme } = useAppTheme();

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

  useEffect(() => {
    initTelemetry();
  }, []);

  // Attach the install token to every same-origin request, then hydrate it from
  // SecureStore. The interceptor is installed first (synchronously) so no early
  // request escapes without it; the token is attached from the next tick on,
  // which is why callers must tolerate the header being absent for the first
  // moments after launch.
  useEffect(() => {
    installFetchInterceptor(getApiBaseUrl());
    void loadInstallToken();
  }, []);

  // Hiding the native splash is the StartupGate's job: it waits for the
  // session as well as the fonts, so the home screen's first paint already
  // knows whether the viewer is signed in and the inline composer arrives with
  // the feed instead of after it.

  if (!loaded && !error) {
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
          {/* Install credential first: the session provider wraps every mutating
            auth call in it, so a fresh install is verified before signing in. */}
          <InstallProvider>
            <SessionProvider>
              {/* Native push registration + tap routing. Inside the session
                provider so it can react to sign-in/out. */}
              <PushRegistrar />
              {/* Real-time session revocation listener (SSE stream). Terminates
                the local session immediately if revoked remotely or on 401. */}
              <SessionRevocationGuard />
              <Stack
                screenOptions={{
                  animation:
                    Platform.OS === "ios" ? "default" : "slide_from_right",
                  contentStyle: { backgroundColor: theme.containerBg },
                  headerShown: false,
                }}
              >
                <Stack.Screen name="index" options={{ animation: "none" }} />
                <Stack.Screen name="posts" />
                <Stack.Screen name="notifications" />
                <Stack.Screen name="bookmarks" />
                <Stack.Screen
                  name="gusts"
                  options={{
                    animation: "fade_from_bottom",
                    animationDuration: 250,
                    contentStyle: { backgroundColor: "#000000" },
                    presentation: "fullScreenModal",
                  }}
                />
                <Stack.Screen name="users/[username]" />
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
                  the app-wide toast stack. */}
              <ComposerModal />
              {/* Floating spotlight search modal, matching web's SpotlightProvider. */}
              <SpotlightModal />
              <Toaster />
              {/* Last so it covers the navigator and every overlay above: it
                  holds the platform splash until the session is known, then
                  dissolves into the app. */}
              <StartupGate fontsReady={loaded || Boolean(error)} />
            </SessionProvider>
          </InstallProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
