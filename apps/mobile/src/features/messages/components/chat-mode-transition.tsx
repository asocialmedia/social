import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AccessibilityInfo, Dimensions, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

export function ChatModeTransition({
  sessionId,
  incognito,
  children,
}: {
  sessionId: string | null;
  incognito: ReactNode;
  children: ReactNode;
}) {
  const [revealedSessionId, setRevealedSessionId] = useState(sessionId);
  const reduceMotion = useReducedMotion();
  const revealing = Boolean(
    sessionId && sessionId !== revealedSessionId && !reduceMotion
  );
  const finishReveal = useCallback(() => {
    setRevealedSessionId(sessionId);
  }, [sessionId]);
  return (
    <View style={{ flex: 1, overflow: "hidden" }}>
      <View
        style={{ display: sessionId && !revealing ? "none" : "flex", flex: 1 }}
        pointerEvents={sessionId ? "none" : "auto"}
        accessibilityElementsHidden={Boolean(sessionId)}
        importantForAccessibility={sessionId ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {sessionId ? (
        <IncognitoReveal
          key={sessionId}
          animate={revealing}
          onComplete={finishReveal}
        >
          {incognito}
        </IncognitoReveal>
      ) : null}
    </View>
  );
}

function IncognitoReveal({
  animate,
  onComplete,
  children,
}: {
  animate: boolean;
  onComplete: () => void;
  children: ReactNode;
}) {
  const height = useSharedValue(Dimensions.get("window").height);
  const progress = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (!animate) {
      progress.set(1);
      return;
    }
    progress.set(
      withTiming(
        1,
        {
          duration: 640,
          easing: Easing.bezier(0.7, 0, 0.16, 1),
          reduceMotion: ReduceMotion.System,
        },
        (finished) => {
          if (finished) {
            scheduleOnRN(onComplete);
          }
        }
      )
    );
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (reduced) => {
        if (reduced) {
          cancelAnimation(progress);
          progress.set(1);
          onComplete();
        }
      }
    );
    return () => {
      cancelAnimation(progress);
      subscription.remove();
    };
  }, [animate, onComplete, progress]);

  const surfaceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.get()) * height.get() }],
  }));
  // Equal, opposite transforms keep the conversation stationary behind the reveal.
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -(1 - progress.get()) * height.get() }],
  }));
  const edgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      progress.get(),
      [0, 0.12, 0.42, 0.82, 1],
      [0, 0.65, 1, 0.2, 0]
    ),
  }));
  return (
    <Animated.View
      onLayout={(event) => {
        if (event.nativeEvent.layout.height > 0) {
          height.set(event.nativeEvent.layout.height);
        }
      }}
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: "#09090b", overflow: "hidden" },
        surfaceStyle,
      ]}
    >
      <Animated.View style={[{ flex: 1 }, contentStyle]}>
        {children}
      </Animated.View>
      {animate ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              height: 32,
              left: 0,
              overflow: "hidden",
              position: "absolute",
              right: 0,
              top: 0,
            },
            edgeStyle,
          ]}
        >
          <LinearGradient
            colors={[
              "rgba(255,255,255,0.045)",
              "rgba(255,255,255,0.01)",
              "rgba(255,255,255,0)",
            ]}
            locations={[0, 0.3, 1]}
            dither={false}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={[
              "rgba(255,255,255,0)",
              "rgba(255,255,255,0.18)",
              "rgba(255,255,255,0)",
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            dither={false}
            style={{ height: StyleSheet.hairlineWidth }}
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
