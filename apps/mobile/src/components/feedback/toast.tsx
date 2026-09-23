// Native counterpart of web's gooey toast (@asm/ui/lib/gooey-toast): a dark
// #232323 card with 12px rounding, a success/error mark, bold title, muted
// description and an optional action button (e.g. "Undo"), auto-dismissing
// after `duration` (5s default). Web anchors bottom-right; on a phone the
// stack sits bottom-center, lifted above the floating nav dock.
import { CircleAlert, CircleCheck } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";

export interface ToastMessage {
  button?: { onClick: () => void; title: string };
  description?: string;
  duration?: number;
  title?: string;
  variant?: "default" | "destructive";
}

interface ToastEntry extends ToastMessage {
  id: number;
}

const useToastStore = create<{ toasts: ToastEntry[] }>(() => ({ toasts: [] }));
let nextId = 1;

export function toast(message: ToastMessage): void {
  const entry = { ...message, id: nextId };
  nextId += 1;
  useToastStore.setState((state) => ({
    // Newest last; keep the stack short.
    toasts: [...state.toasts, entry].slice(-3),
  }));
}

function dismiss(id: number): void {
  useToastStore.setState((state) => ({
    toasts: state.toasts.filter((entry) => entry.id !== id),
  }));
}

const GOOEY_FILL = "#232323";

function ToastCard({ entry }: { entry: ToastEntry }) {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [enter] = useState(() => new Animated.Value(0));
  const destructive = entry.variant === "destructive";

  useEffect(() => {
    Animated.timing(enter, {
      duration: 260,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
      toValue: 1,
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(() => {
      Animated.timing(enter, {
        duration: 200,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        toValue: 0,
        useNativeDriver: true,
      }).start(() => dismiss(entry.id));
    }, entry.duration ?? 5000);
    return () => {
      clearTimeout(timer);
    };
  }, [enter, entry.duration, entry.id]);

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.card,
        {
          opacity: enter,
          transform: [
            {
              translateY: enter.interpolate({
                inputRange: [0, 1],
                outputRange: [16, 0],
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
      {destructive ? (
        <CircleAlert color="#ff6b6b" size={18} />
      ) : (
        <CircleCheck color="#4ade80" size={18} />
      )}
      <View style={styles.copy}>
        {entry.title ? <Text style={styles.title}>{entry.title}</Text> : null}
        {entry.description ? (
          <Text style={styles.description}>{entry.description}</Text>
        ) : null}
      </View>
      {entry.button ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            entry.button?.onClick();
            dismiss(entry.id);
          }}
          style={styles.action}
        >
          <Text style={styles.actionText}>{entry.button.title}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const insets = useSafeAreaInsets();
  if (toasts.length === 0) {
    return null;
  }
  return (
    <View
      pointerEvents="box-none"
      style={[styles.stack, { bottom: insets.bottom + 88 }]}
    >
      {toasts.map((entry) => (
        <ToastCard entry={entry} key={entry.id} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 12,
  },
  card: {
    alignItems: "center",
    backgroundColor: GOOEY_FILL,
    borderRadius: 12,
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
    flexDirection: "row",
    gap: 10,
    maxWidth: 420,
    paddingHorizontal: 14,
    paddingVertical: 12,
    width: "100%",
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  description: {
    color: "rgba(255, 255, 255, 0.7)",
    fontFamily: "SofiaProReg",
    fontSize: 13,
    marginTop: 1,
  },
  stack: {
    alignItems: "center",
    gap: 8,
    left: 16,
    position: "absolute",
    right: 16,
    zIndex: 1000,
  },
  title: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
  },
});
