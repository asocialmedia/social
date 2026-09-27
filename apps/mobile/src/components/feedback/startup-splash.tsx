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
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import splashImage from "@/assets/images/splash-icon.png";
import { ORANGE_GRADIENT } from "@/components/surface/recipes";
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

// The wordmark is SVG text, so it needs an explicit box: a width to centre the
// run in (textAnchor="middle") and a height/baseline to sit it on. The height
// and baseline track the font size, since the box has to hug the glyph run.
const WORDMARK_FONT_SIZE = 16;
const WORDMARK_WIDTH = 260;
const WORDMARK_HEIGHT = 22;
const WORDMARK_BASELINE = 17;
const WORDMARK_GRADIENT_ID = "brandWordmark";

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
        <GradientWordmark />
        <Text style={styles.tagline}>by Singularity Works</Text>
      </View>
    </Animated.View>
  );
}

// Gradient-filled text. React Native cannot fill a <Text> with a gradient -
// expo-linear-gradient paints a background the glyphs then sit on top of - so
// the wordmark is drawn as SVG text filled with a vertical linear gradient.
// That keeps the app's orange (#ff9500 -> #e65500) with nothing behind it.
function GradientWordmark() {
  return (
    <Svg height={WORDMARK_HEIGHT} width={WORDMARK_WIDTH}>
      <Defs>
        <LinearGradient id={WORDMARK_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={ORANGE_GRADIENT[0]} />
          <Stop offset="1" stopColor={ORANGE_GRADIENT[1]} />
        </LinearGradient>
      </Defs>
      {/* System font: this paints before the custom fonts finish loading, and
          swapping faces mid-splash would reflow the wordmark. textAnchor centres
          the run inside the fixed SVG width. */}
      <SvgText
        fill={`url(#${WORDMARK_GRADIENT_ID})`}
        fontSize={WORDMARK_FONT_SIZE}
        fontWeight="700"
        letterSpacing={0.6}
        textAnchor="middle"
        x={WORDMARK_WIDTH / 2}
        y={WORDMARK_BASELINE}
      >
        asocialmedia
      </SvgText>
    </Svg>
  );
}

const styles = StyleSheet.create({
  footer: {
    alignItems: "center",
    bottom: FOOTER_INSET,
    // Tight: the wordmark and the tagline read as one lockup, not two
    // separately-floating elements.
    gap: 4,
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
});
