// Loading skeleton for the post detail screen: 1:1 native port of web's
// PostDetailSkeleton (components/layouts/skeletons/post-detail-skeleton.tsx),
// mobile layout. Same column: back circle + title line, the detail card
// (avatar, two name rows, three text lines, square media, 2+3 action pills),
// the "View more content" heading row, then two feed card skeletons.
// Web's xl-only author rail is desktop chrome and stays out, like the screen
// itself. Pulse treatment matches the feed skeleton; avatar blocks keep the
// native squircle so they preview the avatars that actually paint.
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

function Block({
  borderRadius = 6,
  color,
  height,
  width,
}: {
  borderRadius?: number;
  color: string;
  height: number;
  width?: number | `${number}%`;
}) {
  return (
    <View style={{ backgroundColor: color, borderRadius, height, width }} />
  );
}

function FeedCardSkeleton({ color }: { color: string }) {
  return (
    <View style={styles.feedCard}>
      <View style={styles.feedRow}>
        <Block borderRadius={12} color={color} height={40} width={40} />
        <View style={styles.feedBody}>
          <View style={styles.feedHead}>
            <Block color={color} height={16} width={112} />
            <Block color={color} height={16} width={80} />
            <Block borderRadius={9999} color={color} height={12} width={12} />
            <Block color={color} height={12} width={64} />
          </View>
          <View style={styles.feedText}>
            <Block color={color} height={16} width="100%" />
            <Block color={color} height={16} width="75%" />
          </View>
          <View style={styles.feedMedia}>
            <Block borderRadius={8} color={color} height={224} width="100%" />
          </View>
        </View>
      </View>
    </View>
  );
}

export function PostDetailSkeleton() {
  const { theme } = useAppTheme();
  const color = theme.dividerLine;
  return (
    <View style={styles.root}>
      <Pulse>
        {/* Back button + title */}
        <View style={styles.header}>
          <Block borderRadius={9999} color={color} height={36} width={36} />
          <Block color={color} height={20} width={48} />
        </View>

        {/* Detail post card */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Block borderRadius={12} color={color} height={48} width={48} />
            <View style={styles.cardBody}>
              <View style={styles.cardHead}>
                <View style={styles.cardTitles}>
                  <View style={styles.titleRow}>
                    <Block color={color} height={16} width={128} />
                    <Block color={color} height={12} width={64} />
                  </View>
                  <View style={styles.titleRow}>
                    <Block color={color} height={14} width={96} />
                    <Block
                      borderRadius={9999}
                      color={color}
                      height={24}
                      width={56}
                    />
                  </View>
                </View>
                <Block color={color} height={24} width={24} />
              </View>

              <View style={styles.cardText}>
                <Block color={color} height={16} width="100%" />
                <Block color={color} height={16} width="83%" />
                <Block color={color} height={16} width="66%" />
              </View>

              <View style={[styles.cardMedia, { backgroundColor: color }]} />
            </View>
          </View>

          <View style={styles.actions}>
            <View style={styles.actionGroup}>
              <Block borderRadius={9999} color={color} height={32} width={64} />
              <Block borderRadius={9999} color={color} height={32} width={64} />
            </View>
            <View style={styles.actionGroup}>
              <Block borderRadius={9999} color={color} height={32} width={56} />
              <Block borderRadius={9999} color={color} height={32} width={32} />
              <Block borderRadius={9999} color={color} height={32} width={32} />
            </View>
          </View>
        </View>

        {/* "View more content" heading */}
        <View style={styles.moreRow}>
          <Block color={color} height={16} width={144} />
          <Block color={color} height={16} width={96} />
        </View>

        {/* Feed cards */}
        <View>
          <FeedCardSkeleton color={color} />
          <FeedCardSkeleton color={color} />
        </View>
      </Pulse>
    </View>
  );
}

const styles = StyleSheet.create({
  actionGroup: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    marginTop: 16,
  },
  card: {
    padding: 16,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardHead: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
  },
  cardMedia: {
    aspectRatio: 1,
    borderRadius: 8,
    marginTop: 16,
    width: "100%",
  },
  cardRow: {
    flexDirection: "row",
    gap: 12,
  },
  cardText: {
    gap: 8,
    marginTop: 12,
  },
  cardTitles: {
    flex: 1,
    gap: 8,
    minWidth: 0,
    paddingRight: 64,
  },
  feedBody: {
    flex: 1,
    minWidth: 0,
  },
  feedCard: {
    padding: 16,
  },
  feedHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingRight: 64,
  },
  feedMedia: {
    marginTop: 10,
  },
  feedRow: {
    flexDirection: "row",
    gap: 12,
  },
  feedText: {
    gap: 8,
    marginTop: 10,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  moreRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  root: {
    flex: 1,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
});
