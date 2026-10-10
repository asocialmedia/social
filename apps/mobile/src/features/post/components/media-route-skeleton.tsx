// Loading skeleton for the fullscreen media screen: native port of web's
// MediaRouteSkeleton (components/layouts/skeletons/media-route-skeleton.tsx),
// mobile layout. Same black stage: the mobile header (close circle + avatar
// with two lines), the full-bleed media frame, and a bottom action bar that
// mirrors the real row (eddie pill + vote pair + aura count on the left,
// share + bookmark on the right). Blocks use white-on-black shimmer
// (white/15 + white/10) exactly like web; pulse treatment matches the feed
// skeleton.
//
// The pulse wrapper owns flex:1, not just opacity. Without it the stage's
// flex:1 resolves inside an auto-height parent and collapses to zero, which
// bunched the header and the action bar at the top over a black void.
import { useEffect, useMemo } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const STRONG = "rgba(255, 255, 255, 0.15)";
const FAINT = "rgba(255, 255, 255, 0.1)";

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
  return (
    <Animated.View style={[styles.pulse, { opacity: pulse }]}>
      {children}
    </Animated.View>
  );
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
  width: number;
}) {
  return (
    <View style={{ backgroundColor: color, borderRadius, height, width }} />
  );
}

export function MediaRouteSkeleton() {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <Pulse>
        {/* Mobile header: clears the status bar like the viewer chrome */}
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Block borderRadius={9999} color={STRONG} height={36} width={36} />
          <View style={styles.headerUser}>
            <Block borderRadius={9999} color={STRONG} height={40} width={40} />
            <View style={styles.headerTitles}>
              <Block color={STRONG} height={16} width={112} />
              <Block color={FAINT} height={12} width={80} />
            </View>
          </View>
        </View>

        {/* Full-bleed media stage: the frame fills the stage (never a tiny
            box), like web's h-full max-h-[82vh] panel */}
        <View style={styles.stage}>
          <View style={styles.frameFill} />
        </View>

        {/* Action bar: mirrors the real row, not three generic circles. Left
            is the eddie pill + vote pair + aura count, right is share +
            bookmark, exactly like the loaded panel below the scrim. */}
        <View style={styles.actions}>
          <View style={styles.actionGroup}>
            <Block borderRadius={9999} color={STRONG} height={36} width={92} />
            <Block borderRadius={9999} color={FAINT} height={32} width={32} />
            <Block borderRadius={9999} color={FAINT} height={32} width={32} />
            <Block color={FAINT} height={14} width={36} />
          </View>
          <View style={styles.actionGroup}>
            <Block borderRadius={9999} color={FAINT} height={32} width={32} />
            <Block borderRadius={9999} color={FAINT} height={32} width={32} />
          </View>
        </View>
      </Pulse>
    </View>
  );
}

const styles = StyleSheet.create({
  actionGroup: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  frameFill: {
    alignSelf: "stretch",
    backgroundColor: FAINT,
    borderRadius: 12,
    flex: 1,
    margin: 16,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 20,
    paddingHorizontal: 12,
  },
  headerTitles: {
    gap: 6,
  },
  headerUser: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginLeft: 12,
  },
  pulse: {
    flex: 1,
  },
  root: {
    backgroundColor: "#000000",
    flex: 1,
  },
  stage: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 0,
  },
});
