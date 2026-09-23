// The gust card's floating layers, each a 1:1 port of a gust-card.tsx
// block: the centered play/pause pulse, the double-tap flame bursts, the
// orange seek line (tap or drag to scrub), the live caption banner and the
// full-bleed explicit gate.
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Flame, Pause, Play } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import nosearchImage from "@/assets/images/nosearch.png";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { APPLE_PANEL_TOKENS } from "@/components/surface/recipes";
import { explicitBlurSupported } from "@/features/feed/components/post-media";
import {
  LOGIN_BUTTON_PRESSED_SHADOWS,
  LOGIN_BUTTON_PRESSED_SHADOWS_LIGHT,
  LOGIN_BUTTON_SHADOWS,
  LOGIN_BUTTON_SHADOWS_LIGHT,
  useAppTheme,
} from "@/theme";

import { BURST_DURATION_MS } from "../lib/reel-gestures";
import type { FlameBurst } from "../lib/reel-gestures";

// Web: pops in over 0.2s (opacity 0 -> 1, scale 0.5 -> 1), holds, and
// leaves to scale 0.8 once the 600ms window closes.
export function PlayPulse({
  icon,
  onDone,
}: {
  icon: "pause" | "play";
  onDone: () => void;
}) {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [enter] = useState(() => new Animated.Value(0));
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [exit] = useState(() => new Animated.Value(0));
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);
  useEffect(() => {
    const sequence = Animated.sequence([
      Animated.timing(enter, {
        duration: 200,
        easing: Easing.out(Easing.quad),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.delay(400),
      Animated.timing(exit, {
        duration: 200,
        easing: Easing.out(Easing.quad),
        toValue: 1,
        useNativeDriver: true,
      }),
    ]);
    sequence.start(({ finished }) => {
      if (finished) {
        doneRef.current();
      }
    });
    return () => sequence.stop();
  }, [enter, exit]);
  const opacity = Animated.subtract(enter, exit);
  const scale = Animated.add(
    enter.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
    exit.interpolate({ inputRange: [0, 1], outputRange: [0, -0.2] })
  );
  return (
    <View pointerEvents="none" style={styles.center}>
      <Animated.View
        style={[styles.pulse, { opacity, transform: [{ scale }] }]}
      >
        {icon === "play" ? (
          <Play color="#ffffff" fill="#ffffff" size={32} style={styles.nudge} />
        ) : (
          <Pause color="#ffffff" fill="#ffffff" size={32} />
        )}
      </Animated.View>
    </View>
  );
}

// Web keyframes over 0.85s easeOut: opacity [0, 1, 1, 0], scale
// [0.4, 1.1, 0.9], y [0, -90], rotating from (tilt - 4) to the tilt.
export function FlameBurstView({ burst }: { burst: FlameBurst }) {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const run = Animated.timing(progress, {
      duration: BURST_DURATION_MS,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [progress]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.burst,
        {
          left: burst.x,
          opacity: progress.interpolate({
            inputRange: [0, 0.33, 0.66, 1],
            outputRange: [0, 1, 1, 0],
          }),
          top: burst.y,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -90],
              }),
            },
            {
              rotate: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [`${burst.rotate - 4}deg`, `${burst.rotate}deg`],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [0.4, 1.1, 0.9],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.flameGlow}>
        <Flame color="#f66b15" fill="#f66b15" size={44} />
      </View>
      <Text style={styles.burstText}>+1</Text>
    </Animated.View>
  );
}

// The bottom seek line: a 4px white/20 track with the orange fill, and an
// invisible 16px strip over it that scrubs on tap or drag.
export function SeekBar({
  duration,
  onSeek,
  progress,
}: {
  duration: number;
  onSeek: (seconds: number) => void;
  progress: number;
}) {
  const [width, setWidth] = useState(0);
  const seekTo = (x: number) => {
    if (width <= 0 || duration <= 0) {
      return;
    }
    const ratio = Math.min(1, Math.max(0, x / width));
    onSeek(ratio * duration);
  };
  const percent = Math.min(100, Math.max(0, progress * 100));
  return (
    <View style={styles.seekWrap}>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={styles.seekTrack}
      >
        <LinearGradient
          colors={["#ff9500", "#e65500"]}
          end={{ x: 1, y: 0.5 }}
          start={{ x: 0, y: 0.5 }}
          style={[styles.seekFill, { width: `${percent}%` }]}
        />
      </View>
      <View
        accessibilityLabel="Seek video"
        accessibilityRole="adjustable"
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => seekTo(event.nativeEvent.locationX)}
        onResponderMove={(event) => seekTo(event.nativeEvent.locationX)}
        onResponderTerminationRequest={() => false}
        onStartShouldSetResponder={() => true}
        style={styles.seekHit}
      />
    </View>
  );
}

// Web's caption banner, animated in per cue (0.12s from scale 0.96, y 4);
// the parent keys it by cue so every cue remounts.
export function LiveCaption({ text }: { text: string }) {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [enter] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const run = Animated.timing(enter, {
      duration: 120,
      toValue: 1,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [enter]);
  return (
    <View pointerEvents="none" style={styles.captionRow}>
      <Animated.View
        style={[
          styles.captionBox,
          {
            opacity: enter,
            transform: [
              {
                translateY: enter.interpolate({
                  inputRange: [0, 1],
                  outputRange: [4, 0],
                }),
              },
              {
                scale: enter.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.96, 1],
                }),
              },
            ],
          },
        ]}
      >
        <Text numberOfLines={3} style={styles.captionText}>
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

// ExplicitContentGate for a gust: the poster blurred and dimmed under a
// black/40 veil (fully opaque where blur is unsupported), and the centered
// apple-panel with web's gust label and the premium Continue pill. Playback
// stays held until Continue.
export function GustExplicitGate({
  onContinue,
  posterUri,
}: {
  onContinue: () => void;
  posterUri: string | null;
}) {
  const { isDark } = useAppTheme();
  const panel = isDark ? APPLE_PANEL_TOKENS.dark : APPLE_PANEL_TOKENS.light;
  const title = isDark ? "#eeeeee" : "#202020";
  const muted = isDark ? "#b4b4b4" : "#646464";
  const blurSupported = explicitBlurSupported();
  return (
    <View style={styles.gate}>
      {posterUri ? (
        <Image
          accessibilityLabel=""
          blurRadius={blurSupported ? 24 : 0}
          contentFit="cover"
          source={{ uri: posterUri }}
          style={[styles.fill, styles.gatePoster]}
        />
      ) : null}
      <View
        style={[
          styles.fill,
          { backgroundColor: blurSupported ? "rgba(0, 0, 0, 0.4)" : "#000000" },
        ]}
      />
      <View style={styles.gateCenter}>
        <View
          style={[
            styles.gatePanel,
            {
              backgroundColor: panel.background,
              borderColor: panel.border,
              boxShadow: panel.shadows,
            },
          ]}
        >
          <Image
            accessibilityLabel=""
            contentFit="contain"
            source={nosearchImage}
            style={styles.gateArt}
          />
          <Text style={[styles.gateTitle, { color: title }]}>
            This gust has explicit media.
          </Text>
          <Text style={[styles.gateBody, { color: muted }]}>
            Do you want to continue watching?
          </Text>
          <Pressable
            accessibilityLabel="Show explicit media"
            accessibilityRole="button"
            onPress={onContinue}
          >
            {({ pressed }) => {
              let shadows = isDark
                ? LOGIN_BUTTON_SHADOWS
                : LOGIN_BUTTON_SHADOWS_LIGHT;
              if (pressed) {
                shadows = isDark
                  ? LOGIN_BUTTON_PRESSED_SHADOWS
                  : LOGIN_BUTTON_PRESSED_SHADOWS_LIGHT;
              }
              return (
                <Gradient3D
                  colors={
                    pressed ? ["#e65500", "#d44a00"] : ["#ff9500", "#e65500"]
                  }
                  shadows={shadows}
                  style={[styles.gateBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.gateBtnText}>Continue</Text>
                </Gradient3D>
              );
            }}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  burst: {
    alignItems: "center",
    position: "absolute",
    zIndex: 10,
  },
  burstText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 3,
  },
  captionBox: {
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    borderColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 8,
    borderWidth: 1,
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
    maxWidth: "90%",
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  captionRow: {
    alignItems: "center",
    bottom: 208,
    left: 16,
    position: "absolute",
    right: 16,
    zIndex: 25,
  },
  captionText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 12,
    fontWeight: "normal",
    letterSpacing: 0.3,
    lineHeight: 16,
    textAlign: "center",
  },
  center: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 10,
  },
  fill: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  flameGlow: {
    // drop-shadow-[0_0_18px_rgba(255,149,0,0.9)]; Android 12+ renders it.
    filter: [
      {
        dropShadow: {
          color: "rgba(255, 149, 0, 0.9)",
          offsetX: 0,
          offsetY: 0,
          standardDeviation: 9,
        },
      },
    ],
  },
  gate: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 10,
  },
  gateArt: {
    height: 48,
    width: 48,
  },
  gateBody: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    textAlign: "center",
  },
  gateBtn: {
    height: 36,
    marginTop: 8,
    paddingHorizontal: 24,
  },
  gateBtnText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
    textShadowColor: "rgba(0, 0, 0, 0.15)",
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 1,
  },
  gateCenter: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    padding: 24,
    position: "absolute",
    right: 0,
    top: 0,
  },
  gatePanel: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    maxWidth: 320,
    padding: 16,
  },
  gatePoster: {
    opacity: 0.6,
    transform: [{ scale: 1.05 }],
  },
  gateTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
    textAlign: "center",
  },
  nudge: {
    marginLeft: 4,
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
  pulse: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: 9999,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  seekFill: {
    borderRadius: 9999,
    height: 4,
  },
  seekHit: {
    height: 16,
    left: 4,
    position: "absolute",
    right: 4,
    top: -6,
  },
  seekTrack: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 9999,
    height: 4,
    overflow: "hidden",
  },
  seekWrap: {
    bottom: 0,
    left: 0,
    paddingBottom: 4,
    paddingHorizontal: 4,
    position: "absolute",
    right: 0,
    zIndex: 30,
  },
});
