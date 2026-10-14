import { COMMUNITY_MAX_OWNED } from "@asm/db/communities";
import { Flame } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/theme";

import type { CommunityCreationQuota } from "../lib/communities-api";

export function CommunityCreationGate({
  quota,
}: {
  quota: CommunityCreationQuota;
}) {
  const { theme } = useAppTheme();
  const requirement = quota.nextRequirement ?? 0;
  const remaining = Math.max(0, requirement - quota.standing);
  const ordinal =
    ["1st", "2nd", "3rd", "4th"][quota.owned] ?? `${quota.owned + 1}th`;
  return (
    <View style={styles.root}>
      <Text style={[styles.hint, { color: theme.dividerText }]}>
        Standing grows with what you contribute.
      </Text>
      <View style={styles.row}>
        <View style={styles.row}>
          <Flame color="#f97316" size={14} />
          <Text style={[styles.hint, { color: theme.dividerText }]}>Aura</Text>
        </View>
        <Text style={[styles.hint, { color: theme.inputText }]}>
          {quota.aura.toLocaleString()}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={[styles.label, { color: theme.inputText }]}>Standing</Text>
        <Text style={[styles.label, { color: theme.inputText }]}>
          {quota.standing.toLocaleString()}
        </Text>
      </View>
      {quota.maxed ? (
        <Text style={[styles.hint, { color: theme.dividerText }]}>
          You have founded all {COMMUNITY_MAX_OWNED} communities.
        </Text>
      ) : (
        <>
          <View style={styles.row}>
            <Text style={[styles.hint, { color: theme.dividerText }]}>
              Your {ordinal} community
            </Text>
            <Text style={[styles.hint, { color: theme.inputText }]}>
              bar {requirement.toLocaleString()}
            </Text>
          </View>
          <View style={[styles.track, { backgroundColor: theme.cardBorder }]}>
            <View
              style={[
                styles.progress,
                {
                  width: `${Math.max(0, Math.min(1, requirement > 0 ? quota.standing / requirement : 1)) * 100}%`,
                },
              ]}
            />
          </View>
          <Text style={[styles.hint, { color: theme.dividerText }]}>
            {remaining
              ? `${remaining.toLocaleString()} standing to the bar.`
              : "You’ve cleared the bar."}
          </Text>
        </>
      )}
      {quota.reachAura > quota.reachCounted ? (
        <Text style={[styles.hint, { color: theme.dividerText }]}>
          Reach from views and shares counts up to{" "}
          {quota.reachCounted.toLocaleString()} toward standing.
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  hint: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 18 },
  label: { fontFamily: "SofiaProMed", fontSize: 14 },
  progress: { backgroundColor: "#f97316", borderRadius: 999, height: 6 },
  root: { gap: 12 },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "space-between",
  },
  track: { borderRadius: 999, height: 6, overflow: "hidden" },
});
