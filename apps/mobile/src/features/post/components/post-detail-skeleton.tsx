// Loading skeleton for the post detail screen: mirrors web
// PostDetailSkeleton (header row + detail card + eddies) with the feed's
// pulse treatment so the detail paint matches the list paint.
import { useEffect, useMemo } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { useAppTheme } from "@/theme";

function Pulse({ children }: { children: React.ReactNode }) {
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
  return <Animated.View style={{ opacity: pulse }}>{children}</Animated.View>;
}

export function PostDetailSkeleton() {
  const { theme } = useAppTheme();
  const block = { backgroundColor: theme.dividerLine };
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={[styles.back, block]} />
        <View style={[styles.title, block]} />
      </View>
      <Pulse>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={[styles.avatar, block]} />
            <View style={styles.body}>
              <View style={[styles.line, block, styles.name]} />
              <View style={[styles.line, block, styles.handle]} />
              <View style={[styles.line, block, styles.textFull]} />
              <View style={[styles.line, block, styles.textPartial]} />
              <View style={[styles.media, block]} />
            </View>
          </View>
        </View>
      </Pulse>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderRadius: 12,
    height: 40,
    width: 40,
  },
  back: {
    borderRadius: 9999,
    height: 36,
    width: 36,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  card: {
    padding: 16,
  },
  handle: {
    width: 80,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  line: {
    borderRadius: 4,
    height: 14,
    marginTop: 8,
  },
  media: {
    borderRadius: 8,
    height: 180,
    marginTop: 12,
  },
  name: {
    width: 110,
  },
  root: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  textFull: {
    width: "100%",
  },
  textPartial: {
    width: "75%",
  },
  title: {
    borderRadius: 4,
    height: 20,
    width: 60,
  },
});
