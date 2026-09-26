// Startup chrome: the brand splash (icon + wordmark) and the gate that decides
// when the platform splash may be dismissed.
//
// The native splash is held until the session has resolved, not just the fonts.
// Hiding it on fonts alone paints the home screen while the session is still
// pending, and since the inline composer and the header avatar are both gated
// on a known session, they then arrive a beat AFTER the posts - the composer
// popping into an already-painted feed. Holding the gate means the first frame
// the reader sees already knows who they are, so the header, the feed and the
// composer all arrive together.
//
// A bounded timeout backstops the gate: a session that never settles (offline,
// hung request) must not strand someone on the splash.
import { Image } from "expo-image";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import splashImage from "@/assets/images/splash-icon.png";
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  ORANGE_BUTTON_SHADOWS,
  ORANGE_GRADIENT,
} from "@/components/surface/recipes";
import { useSessionContext } from "@/features/auth/state/session";

// Matches the native splash backgroundColor in app.json, so the hand-off from
// the platform splash to this overlay is invisible. A fixed brand tone rather
// than the app theme: the scheme is not known this early, and deriving it here
// would flash light-on-dark (or worse) on every cold start.
const SPLASH_BACKGROUND = "#1f1f1f";

// Matches the platform splash's imageWidth, so the mark does not jump size at
// the hand-off.
const LOGO_SIZE = 140;
// Wordmark and tagline sit low, clear of the home indicator on gesture-nav
// devices, the way a native splash does.
const FOOTER_INSET = 72;

// The icon grows very slightly as it dissolves, so the brand mark reads as
// handing off to the app rather than simply blinking out.
const EXIT_DURATION = 420;
const EXIT_SCALE = 1.06;

// Comfortably longer than a warm session round trip, so the normal path always
// waits for the real answer and only a genuinely stuck session hits this.
const MAX_HOLD_MS = 2200;

export function StartupGate({ fontsReady }: { fontsReady: boolean }) {
  const { isPending } = useSessionContext();
  const [overdue, setOverdue] = useState(false);

  // Only armed while the session is genuinely outstanding; the flag is what
  // releases the gate when the answer never arrives.
  useEffect(() => {
    if (!fontsReady || !isPending) {
      return;
    }
    const timer = setTimeout(() => setOverdue(true), MAX_HOLD_MS);
    return () => clearTimeout(timer);
  }, [fontsReady, isPending]);

  // Derived rather than assigned in an effect: the gate opens the moment the
  // session resolves, with no extra render hop in between.
  const ready = fontsReady && (!isPending || overdue);

  useEffect(() => {
    if (!ready) {
      return;
    }
    // Rejects when the splash is already gone (fast refresh, or a slow gate
    // that lost a race); there is nothing left to do in that case.
    async function hideNativeSplash() {
      try {
        await SplashScreen.hideAsync();
      } catch {
        // Already dismissed; nothing to restore.
      }
    }
    void hideNativeSplash();
  }, [ready]);

  return <BrandSplash exiting={ready} />;
}

function BrandSplash({ exiting }: { exiting: boolean }) {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; the animation driver mutates it, never the setter
  const [progress] = useState(() => new Animated.Value(1));
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    if (!exiting) {
      return;
    }
    const animation = Animated.timing(progress, {
      duration: EXIT_DURATION,
      easing: Easing.out(Easing.cubic),
      toValue: 0,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
    return () => animation.stop();
  }, [exiting, progress]);

  if (!mounted) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents={exiting ? "none" : "auto"}
      style={[StyleSheet.absoluteFill, styles.splash, { opacity: progress }]}
    >
      <Animated.View
        style={[
          styles.logoWrap,
          {
            transform: [
              {
                scale: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [EXIT_SCALE, 1],
                }),
              },
            ],
          },
        ]}
      >
        <Image
          accessibilityLabel="asocialmedia"
          contentFit="contain"
          source={splashImage}
          style={styles.logo}
        />
      </Animated.View>
      <View style={styles.footer}>
        {/* The orange `.btn-3d` recipe: Gradient3D keeps the dual border (the
            bright inner lip over the gradient) that a plain background loses,
            which is the same construction as every primary button in the app.
            The dark shadow list is the right one here - the splash is always
            the dark brand tone regardless of the system scheme. */}
        <Gradient3D
          colors={ORANGE_GRADIENT}
          shadows={ORANGE_BUTTON_SHADOWS}
          style={styles.wordmarkPill}
        >
          {/* System font, not SofiaPro: this paints before the custom fonts
              finish loading, and swapping faces mid-splash would reflow the
              wordmark. */}
          <Text style={styles.wordmark}>asocialmedia</Text>
        </Gradient3D>
        <Text style={styles.tagline}>by singularity works</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  footer: {
    alignItems: "center",
    bottom: FOOTER_INSET,
    gap: 10,
    left: 0,
    position: "absolute",
    right: 0,
  },
  logo: {
    height: LOGO_SIZE,
    width: LOGO_SIZE,
  },
  logoWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  splash: {
    alignItems: "center",
    backgroundColor: SPLASH_BACKGROUND,
    justifyContent: "center",
    // Above the navigator stack and every overlay, so it covers the whole app
    // for the duration rather than only the first screen.
    zIndex: 1000,
  },
  tagline: {
    color: "rgba(255, 255, 255, 0.55)",
    fontSize: 12,
    letterSpacing: 0.8,
  },
  wordmark: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.6,
    // Matches `.btn-3d`, so the pill reads as the app's own button surface.
    ...({ textShadow: "0 1px 1px rgba(0, 0, 0, 0.2)" } as Record<
      string,
      string
    >),
  },
  wordmarkPill: {
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
});
