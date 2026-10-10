// The gust card's floating layers, each a 1:1 port of a gust-card.tsx
// block: the centered play/pause pulse, the double-tap flame bursts, the
// orange seek line (tap or drag to scrub), the live caption banner and the
// full-bleed explicit gate.
import { auraParticles, nextAuraBurstTiming } from "@asm/ui/lib/aura-burst";
import type { AuraBurstTiming } from "@asm/ui/lib/aura-burst";
import { Image } from "expo-image";
import { Flame, Pause, Play } from "lucide-react-native";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Reanimated, {
  Easing as ReanimatedEasing,
  ReduceMotion,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import nosearchImage from "@/assets/images/nosearch.png";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { APPLE_PANEL_TOKENS } from "@/components/surface/recipes";
import { explicitBlurSupported } from "@/features/feed/components/post-media";
import { haptic } from "@/lib/haptics";
import {
  LOGIN_BUTTON_PRESSED_SHADOWS,
  LOGIN_BUTTON_PRESSED_SHADOWS_LIGHT,
  LOGIN_BUTTON_SHADOWS,
  LOGIN_BUTTON_SHADOWS_LIGHT,
  useAppTheme,
} from "@/theme";

import { addBurst } from "../lib/reel-gestures";
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

function AuraParticle({
  burst,
  particle,
}: {
  burst: FlameBurst;
  particle: ReturnType<typeof auraParticles>[number];
}) {
  const progress = useSharedValue(0);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    progress.set(
      withTiming(1, {
        duration: burst.durationMs,
        easing: ReanimatedEasing.linear,
        reduceMotion: ReduceMotion.Never,
      })
    );
  }, [burst.durationMs, progress]);
  const animated = useAnimatedStyle(() => ({
    opacity: interpolate(
      progress.get(),
      [0, 0.08, 0.72, 1],
      [0, particle.opacity, particle.opacity, 0]
    ),
    transform: reducedMotion
      ? []
      : [
          { translateX: particle.drift * progress.get() },
          { translateY: -particle.lift * progress.get() },
          { rotate: `${particle.rotation * progress.get()}deg` },
          {
            scale: interpolate(progress.get(), [0, 0.2, 1], [0.95, 1.18, 0.8]),
          },
        ],
  }));
  return (
    <Reanimated.View
      pointerEvents="none"
      style={[
        styles.burst,
        {
          height: particle.size,
          left: burst.x - particle.size / 2,
          top: burst.y - particle.size / 2,
          width: particle.size,
        },
        animated,
      ]}
    >
      <Flame
        color={particle.edge}
        fill={particle.fill}
        size={particle.size}
        strokeWidth={1.5}
      />
      <Flame
        color={particle.light}
        fill={particle.light}
        size={particle.size * 0.4}
        strokeWidth={1}
        style={{ bottom: particle.size * 0.15, position: "absolute" }}
      />
    </Reanimated.View>
  );
}

export interface AuraBurstHandle {
  spawn: (x: number, y: number) => void;
}

export function AuraBurstLayer({ ref }: { ref: Ref<AuraBurstHandle> }) {
  const [bursts, setBursts] = useState<FlameBurst[]>([]);
  const nextId = useRef(0);
  const timing = useRef<AuraBurstTiming | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      spawn(x, y) {
        nextId.current += 1;
        const id = nextId.current;
        const next = nextAuraBurstTiming(Date.now(), timing.current);
        timing.current = next;
        haptic("selection");
        setBursts((current) =>
          addBurst(current, { durationMs: next.durationMs, id, x, y })
        );
        if (timer.current) {
          clearTimeout(timer.current);
        }
        timer.current = setTimeout(() => setBursts([]), next.durationMs + 150);
      },
    }),
    []
  );
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    []
  );
  return bursts.map((burst) => <FlameBurstView burst={burst} key={burst.id} />);
}

export function FlameBurstView({ burst }: { burst: FlameBurst }) {
  return auraParticles(burst.id).map((particle, index) => (
    <AuraParticle
      burst={burst}
      key={`${burst.id}-${index}`}
      particle={particle}
    />
  ));
}

export { SeekBar } from "./gust-seek-bar";

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
    ...({ textShadow: "0 1px 1px rgba(0, 0, 0, 0.15)" } as Record<
      string,
      string
    >),
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
});
