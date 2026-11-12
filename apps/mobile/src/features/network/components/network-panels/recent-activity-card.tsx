// Native port of web's `network-panels/recent-activity-card.tsx`. Clearing has
// no confirmation on web; the hook shows the same toasts.
import type { NetworkSettings } from "@asm/protocols/discovery";
import { History } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { themeText } from "@/components/surface/recipes";
import { useSessionContext } from "@/features/auth/state/session";
import { SettingsButton } from "@/features/settings/components/settings-ui";
import { useAppTheme } from "@/theme";

import { PanelSection, TopicTag, panelStyles } from "./panel-ui";

export function RecentActivityCard({
  clearActivity,
  disabled,
  persona,
  revision,
}: {
  clearActivity: () => Promise<boolean>;
  disabled: boolean;
  persona: NetworkSettings["persona"];
  revision?: number;
}) {
  const { isDark, theme } = useAppTheme();
  const { user } = useSessionContext();
  const { muted } = themeText(isDark);
  const [clearing, setClearing] = useState(false);
  const canClear =
    !disabled && !clearing && revision !== undefined && Boolean(user);

  return (
    <PanelSection
      count={`${persona.signalCount} interactions`}
      description="Recent browsing and interactions help this profile learn what you enjoy."
      icon={History}
      id="settings-network-activity"
      title="Recent activity"
    >
      <View style={panelStyles.body}>
        {persona.learnedInterests.length ? (
          <View style={panelStyles.wrap}>
            {persona.learnedInterests.map((topic) => (
              <TopicTag key={topic} label={topic} />
            ))}
          </View>
        ) : (
          <Text style={[panelStyles.mutedSm, { color: muted }]}>
            No recent activity for this profile.
          </Text>
        )}
        <View
          style={[
            panelStyles.divider,
            styles.footer,
            { borderTopColor: theme.dividerLine },
          ]}
        >
          <Text
            style={[panelStyles.muted, styles.footerCopy, { color: muted }]}
          >
            Clearing starts this profile’s learning again. Your chosen interests
            and connected accounts stay.
          </Text>
          <SettingsButton
            disabled={!canClear}
            label={clearing ? "Clearing…" : "Clear recent activity"}
            onPress={async () => {
              setClearing(true);
              await clearActivity().finally(() => {
                setClearing(false);
              });
            }}
            size="sm"
            tone="gray"
          />
        </View>
      </View>
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  footer: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
  },
  footerCopy: { flexBasis: 200, flexGrow: 1 },
});
