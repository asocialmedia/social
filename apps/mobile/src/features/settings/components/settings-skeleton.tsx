// Loading placeholders for the settings tabs, mirroring web's
// `SettingsPageSkeleton`: a section header (icon tile + title/description
// lines) and cards whose fields are grey bars. The gentle opacity pulse is the
// same one the feed and notification skeletons use, so every surface reads as
// one system. Replaces the ActivityIndicators the tabs used to show.
import { useEffect, useMemo } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { useAppTheme } from "@/theme";

function usePulse(): Animated.Value {
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
  return pulse;
}

// Web's `SettingsCardSkeleton`: the orange tile, a title/description pair, a
// trailing pill, then two field bars.
export function SettingsCardSkeleton({ fields = 2 }: { fields?: number }) {
  const { theme } = useAppTheme();
  const pulse = usePulse();
  const block = { backgroundColor: theme.dividerLine };
  return (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
        { opacity: pulse },
      ]}
    >
      <View style={styles.headRow}>
        <View style={styles.headCopy}>
          <View style={[styles.tile, block]} />
          <View style={styles.headLines}>
            <View style={[styles.line, block, styles.title]} />
            <View style={[styles.line, block, styles.desc]} />
          </View>
        </View>
        <View style={[styles.pill, block]} />
      </View>
      <View style={styles.fields}>
        {Array.from({ length: fields }, (_, index) => (
          <View
            key={index}
            style={[
              styles.field,
              block,
              index === 1 ? styles.fieldShort : null,
            ]}
          />
        ))}
      </View>
    </Animated.View>
  );
}

// The section header placeholder (icon tile + title/description).
export function SettingsHeaderSkeleton() {
  const { theme } = useAppTheme();
  const pulse = usePulse();
  const block = { backgroundColor: theme.dividerLine };
  return (
    <Animated.View style={[styles.headerRow, { opacity: pulse }]}>
      <View style={[styles.headerTile, block]} />
      <View style={styles.headLines}>
        <View style={[styles.line, block, styles.headerTitle]} />
        <View style={[styles.line, block, styles.headerDesc]} />
      </View>
    </Animated.View>
  );
}

// A list of subcard rows (passkeys, sessions), matching the row they replace.
export function SettingsRowsSkeleton({ rows = 2 }: { rows?: number }) {
  const { theme } = useAppTheme();
  const pulse = usePulse();
  const block = { backgroundColor: theme.dividerLine };
  return (
    <Animated.View style={[styles.rows, { opacity: pulse }]}>
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={index}
          style={[
            styles.row,
            { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
          ]}
        >
          <View style={styles.headLines}>
            <View style={[styles.line, block, styles.rowTitle]} />
            <View style={[styles.line, block, styles.rowSub]} />
          </View>
          <View style={[styles.rowAction, block]} />
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    gap: 20,
    padding: 20,
  },
  desc: { width: "70%" },
  field: { borderRadius: 12, height: 44, width: "100%" },
  fieldShort: { width: "80%" },
  fields: { gap: 12 },
  headCopy: { alignItems: "center", flexDirection: "row", gap: 12 },
  headLines: { gap: 8 },
  headRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  headerDesc: { width: 200 },
  headerRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  headerTile: { borderRadius: 12, height: 40, width: 40 },
  headerTitle: { height: 16, width: 96 },
  line: { borderRadius: 4, height: 12 },
  pill: { borderRadius: 9999, height: 32, width: 80 },
  row: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    padding: 14,
  },
  rowAction: { borderRadius: 9999, height: 36, width: 72 },
  rowSub: { width: 140 },
  rowTitle: { height: 14, width: 120 },
  rows: { gap: 8 },
  tile: { borderRadius: 12, height: 40, width: 40 },
  title: { height: 14, width: 140 },
});
