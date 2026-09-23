// Loading placeholder for the notifications feed, mirroring web's
// NotificationsSkeleton rows: a 40px avatar with the type badge, two header
// lines, a snippet and a timestamp. The gentle opacity pulse matches the feed
// skeleton so the two surfaces read as one system.
import { useEffect, useMemo } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { useAppTheme } from "@/theme";

function SkeletonRow() {
  const { theme } = useAppTheme();
  const pulse = useMemo(() => new Animated.Value(0.45), []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 900,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 900,
          toValue: 0.45,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [pulse]);

  const block = { backgroundColor: theme.dividerLine };
  return (
    <Animated.View style={[styles.row, { opacity: pulse }]}>
      <View style={styles.avatarWrap}>
        <View style={[styles.avatar, block]} />
        <View style={[styles.badge, block]} />
      </View>
      <View style={styles.body}>
        <View style={[styles.line, block, styles.name]} />
        <View style={[styles.line, block, styles.action]} />
        <View style={[styles.line, block, styles.snippet]} />
        <View style={[styles.line, block, styles.time]} />
      </View>
    </Animated.View>
  );
}

export function NotificationsSkeleton() {
  const { theme } = useAppTheme();
  return (
    <View>
      {[0, 1, 2, 3, 4].map((index) => (
        <View
          key={index}
          style={
            index > 0
              ? { borderTopColor: theme.cardBorder, borderTopWidth: 1 }
              : undefined
          }
        >
          <SkeletonRow />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    marginTop: 10,
    width: 80,
  },
  avatar: {
    borderRadius: 12,
    height: 40,
    width: 40,
  },
  avatarWrap: {
    height: 40,
    width: 40,
  },
  badge: {
    borderRadius: 9999,
    bottom: -4,
    height: 20,
    position: "absolute",
    right: -4,
    width: 20,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  line: {
    borderRadius: 4,
    height: 12,
  },
  name: {
    width: 112,
  },
  row: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  snippet: {
    marginTop: 8,
    width: "72%",
  },
  time: {
    height: 10,
    marginTop: 8,
    width: 48,
  },
});
