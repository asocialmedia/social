// Native port of web's FeedSourceMenu (components/protocols/feed-source-menu):
// a 36px `icon-btn-3d` Settings2 trigger, with a primary dot once the source is
// not "All networks", opening a `panel-3d` "Feed tuning" popover anchored under
// it. Signed in, the popover leads with the recommendation profile pills (the
// active one an orange pill), a Manage link and the interests summary; then the
// three source rows (All networks, asocialmedia filled orange, Bluesky filled
// Bluesky blue when chosen) and, on Following, the cross-network footnote.
import type { FeedSource } from "@asm/protocols/discovery";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Brain, Check, RotateCcw, Settings2 } from "lucide-react-native";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { ViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";

import asmLogo from "@/assets/images/asm.png";
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  iconButton,
  ORANGE_GRADIENT,
  orangeSurfaceShadows,
  panel3d,
} from "@/components/surface/recipes";
import { useSessionContext } from "@/features/auth/state/session";
import { chip3d, surface3d } from "@/features/messages/lib/message-recipes";
import { useNetworkSettings } from "@/features/network/state/use-network-settings";
import { haptic } from "@/lib/interaction/haptics";
import { useAppTheme } from "@/theme";

import {
  hydrateFeedSource,
  useFeedSourceStore,
} from "../state/feed-source-store";
import { BlueskyIcon } from "./bluesky-icon";
import type { MenuAnchor } from "./more-menu";

// text-primary, hsl(22.93 92.59% 52.35%).
const PRIMARY = "#f66b15";
const BLUESKY_GRADIENT = ["#159dff", "#0866df"] as const;
const PANEL_WIDTH = 304;
const SIDE_OFFSET = 8;
const EDGE_MARGIN = 12;
const ANIM_MS = 150;

// `.bluesky-3d-surface`, light + dark.
function blueskySurfaceShadows(isDark: boolean): string {
  return isDark
    ? "inset 0 0 0 1px rgba(255, 255, 255, 0.28), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px #0758bf, 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 70, 180, 0.2)"
    : "inset 0 0 0 1px rgba(255, 255, 255, 0.5), inset 0 1.5px 2px rgba(255, 255, 255, 0.65), 0 0 0 1px rgba(8, 102, 223, 0.4), 0 1px 2px rgba(0, 70, 180, 0.25), 0 3px 7px -2px rgba(0, 70, 180, 0.3)";
}

// Two interlocking rings: "both networks in one stream".
function AllNetworksMark({ color }: { color: string }) {
  return (
    <Svg fill="none" height={16} viewBox="0 0 16 16" width={16}>
      <Circle cx={6.3} cy={8} r={4.3} stroke={color} strokeWidth={1.5} />
      <Circle
        cx={9.7}
        cy={8}
        opacity={0.5}
        r={4.3}
        stroke={color}
        strokeWidth={1.5}
      />
    </Svg>
  );
}

const SOURCE_OPTIONS: readonly {
  description: string;
  label: string;
  value: FeedSource;
}[] = [
  {
    description: "asocialmedia and Bluesky together",
    label: "All networks",
    value: "all",
  },
  {
    description: "Local communities and posts",
    label: "asocialmedia",
    value: "asm",
  },
  {
    description: "Public AT Protocol discovery",
    label: "Bluesky",
    value: "bluesky",
  },
];

function SourceRow({
  description,
  label,
  onPress,
  selected,
  value,
}: {
  description: string;
  label: string;
  onPress: () => void;
  selected: boolean;
  value: FeedSource;
}) {
  const { isDark, theme } = useAppTheme();
  const filled = selected && value !== "all";
  const foreground = filled ? "#ffffff" : theme.inputText;
  const muted = filled ? "rgba(255, 255, 255, 0.8)" : theme.dividerText;
  let mark: ReactNode = (
    <AllNetworksMark color={selected ? foreground : muted} />
  );
  if (value === "asm") {
    mark = (
      <Image
        contentFit="contain"
        source={asmLogo}
        style={styles.asmMark}
        tintColor={filled ? "#ffffff" : undefined}
      />
    );
  } else if (value === "bluesky") {
    // Web's `text-sky-500` idle tone; white on its own blue fill.
    mark = <BlueskyIcon color={filled ? "#ffffff" : "#0ea5e9"} />;
  }
  const body = (
    <>
      <View style={styles.mark}>{mark}</View>
      <View style={styles.rowText}>
        <Text
          numberOfLines={1}
          style={[styles.rowLabel, { color: foreground }]}
        >
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.rowDescription, { color: muted }]}
        >
          {description}
        </Text>
      </View>
      {selected ? <Check color={foreground} size={16} strokeWidth={3} /> : null}
    </>
  );
  let surface: ReactNode;
  if (filled) {
    surface = (
      <Gradient3D
        colors={value === "asm" ? ORANGE_GRADIENT : BLUESKY_GRADIENT}
        radius={12}
        shadows={
          value === "asm"
            ? orangeSurfaceShadows(isDark)
            : blueskySurfaceShadows(isDark)
        }
        style={styles.row}
      >
        {body}
      </Gradient3D>
    );
  } else if (selected) {
    // The neutral selection sits a step above the panel (`surface-3d bg-card`).
    const recipe = surface3d(isDark);
    surface = (
      <View
        style={[
          styles.row,
          {
            backgroundColor: theme.cardBg,
            borderColor: recipe.border,
            borderWidth: 1,
            boxShadow: recipe.shadows,
          },
        ]}
      >
        {body}
      </View>
    );
  } else {
    surface = <View style={styles.row}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        transform: [{ translateY: pressed ? 1 : 0 }],
      })}
    >
      {surface}
    </Pressable>
  );
}

export function FeedSourceMenu({ following }: { following: boolean }) {
  const { isDark, theme } = useAppTheme();
  const { user } = useSessionContext();
  const network = useNetworkSettings();
  const router = useRouter();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const source = useFeedSourceStore((state) => state.source);
  const setSource = useFeedSourceStore((state) => state.setSource);
  const trigger = useRef<ViewInstance>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    void hydrateFeedSource();
  }, []);
  useEffect(() => {
    if (!anchor) {
      return;
    }
    progress.setValue(0);
    const enter = Animated.timing(progress, {
      duration: ANIM_MS,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      toValue: 1,
      useNativeDriver: true,
    });
    enter.start();
    return () => enter.stop();
  }, [anchor, progress]);

  const customized = source !== "all";
  const resting = iconButton(isDark);
  const panel = panel3d(isDark);
  const chip = chip3d(isDark);
  const { preferences } = network.settings;
  const activeProfile = preferences.profiles.find(
    (profile) => profile.id === preferences.activeProfileId
  );
  let summary = "Loading profiles…";
  if (network.ready) {
    const count = activeProfile?.interests.length ?? 0;
    const interests = activeProfile
      ? `${count} ${count === 1 ? "interest" : "interests"}`
      : "No interests yet";
    const signals = network.settings.persona.signalCount;
    summary = `${interests}${
      signals > 0
        ? ` · learning from ${signals} recent interactions`
        : " · learning starts as you browse"
    }`;
  }
  const width = Math.min(PANEL_WIDTH, window.width - 24);

  return (
    <View>
      <Pressable
        accessibilityLabel={`Feed settings, source: ${source}`}
        accessibilityRole="button"
        hitSlop={4}
        onPress={() => {
          haptic();
          trigger.current?.measureInWindow((x, y, triggerWidth, height) => {
            setAnchor({ height, width: triggerWidth, x, y });
          });
        }}
        ref={trigger}
        style={({ pressed }) => [
          styles.trigger,
          {
            backgroundColor: resting.background,
            boxShadow: resting.shadows,
            transform: [{ translateY: pressed ? 1 : 0 }],
          },
        ]}
      >
        <Settings2
          color={customized ? theme.inputText : resting.color}
          size={16}
        />
        {customized ? (
          <View style={[styles.dot, { borderColor: theme.containerBg }]} />
        ) : null}
      </Pressable>
      {anchor ? (
        <Modal
          animationType="none"
          navigationBarTranslucent
          onRequestClose={() => setAnchor(null)}
          statusBarTranslucent
          transparent
          visible
        >
          <Pressable
            accessibilityLabel="Close feed tuning"
            onPress={() => setAnchor(null)}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View
            style={[
              styles.panel,
              {
                backgroundColor: panel.background,
                borderColor: panel.border,
                boxShadow: panel.shadows,
                opacity: progress,
                right: Math.max(
                  EDGE_MARGIN,
                  window.width - (anchor.x + anchor.width)
                ),
                top: Math.max(
                  insets.top + EDGE_MARGIN,
                  anchor.y + anchor.height + SIDE_OFFSET
                ),
                transform: [
                  {
                    scale: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.95, 1],
                    }),
                  },
                ],
                transformOrigin: "top right",
                width,
              },
            ]}
          >
            <View style={styles.header}>
              <Text style={[styles.title, { color: theme.inputText }]}>
                Feed tuning
              </Text>
              {customized ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setSource("all")}
                  style={[
                    styles.reset,
                    {
                      backgroundColor: chip.background,
                      borderColor: chip.border,
                      boxShadow: chip.shadows,
                    },
                  ]}
                >
                  <RotateCcw color={theme.dividerText} size={12} />
                  <Text
                    style={[styles.resetText, { color: theme.dividerText }]}
                  >
                    Reset
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {user ? (
              <View
                style={[
                  styles.profiles,
                  { borderBottomColor: theme.cardBorder },
                ]}
              >
                <View style={styles.profilesHead}>
                  <View style={styles.legend}>
                    <Brain color={theme.dividerText} size={14} />
                    <Text
                      style={[styles.legendText, { color: theme.dividerText }]}
                    >
                      Recommendation profile
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="link"
                    hitSlop={6}
                    onPress={() => {
                      setAnchor(null);
                      router.push("/settings?tab=network&section=profiles");
                    }}
                  >
                    <Text style={[styles.manage, { color: theme.dividerText }]}>
                      Manage
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.pills}>
                  {preferences.profiles.map((profile) => {
                    const active = profile.id === preferences.activeProfileId;
                    const disabled = network.isSaving || !network.ready;
                    const label = (
                      <>
                        {active ? (
                          <Check color="#ffffff" size={12} strokeWidth={3} />
                        ) : null}
                        <Text
                          style={[
                            styles.pillText,
                            { color: active ? "#ffffff" : theme.dividerText },
                          ]}
                        >
                          {profile.name}
                        </Text>
                      </>
                    );
                    return (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled, selected: active }}
                        disabled={disabled}
                        key={profile.id}
                        onPress={() => {
                          void network.save({
                            ...preferences,
                            activeProfileId: profile.id,
                          });
                        }}
                        style={disabled ? styles.disabled : undefined}
                      >
                        {active ? (
                          <Gradient3D
                            colors={ORANGE_GRADIENT}
                            radius={8}
                            shadows={orangeSurfaceShadows(isDark)}
                            style={styles.pill}
                          >
                            {label}
                          </Gradient3D>
                        ) : (
                          <View
                            style={[
                              styles.pill,
                              {
                                backgroundColor: chip.background,
                                borderColor: chip.border,
                                borderRadius: 8,
                                borderWidth: 1,
                                boxShadow: chip.shadows,
                              },
                            ]}
                          >
                            {label}
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={[styles.summary, { color: theme.dividerText }]}>
                  {summary}
                </Text>
              </View>
            ) : null}

            <View style={styles.rows}>
              {SOURCE_OPTIONS.map((option) => (
                <SourceRow
                  description={option.description}
                  key={option.value}
                  label={option.label}
                  onPress={() => setSource(option.value)}
                  selected={source === option.value}
                  value={option.value}
                />
              ))}
            </View>

            {following ? (
              <Text style={[styles.footnote, { color: theme.dividerText }]}>
                Following shows ASM users and Bluesky accounts you follow in
                ASM. No linked Bluesky account required.
              </Text>
            ) : null}
          </Animated.View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  asmMark: { height: 16, width: 16 },
  disabled: { opacity: 0.5 },
  // `bg-primary size-2 ring-2 -top-0.5 -right-0.5`.
  dot: {
    backgroundColor: PRIMARY,
    borderRadius: 6,
    borderWidth: 2,
    height: 12,
    position: "absolute",
    right: -3,
    top: -3,
    width: 12,
  },
  footnote: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
    lineHeight: 14,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  legend: { alignItems: "center", flexDirection: "row", gap: 6 },
  legendText: { fontFamily: "SofiaProBold", fontSize: 11 },
  manage: { fontFamily: "SofiaProMed", fontSize: 11, paddingHorizontal: 4 },
  mark: {
    alignItems: "center",
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  // `w-76 p-2.5`, panel-3d, rounded-xl.
  panel: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    position: "absolute",
  },
  pill: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pillText: { fontFamily: "SofiaProMed", fontSize: 12 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  profiles: {
    borderBottomWidth: 1,
    gap: 8,
    marginBottom: 8,
    paddingBottom: 12,
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  profilesHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  reset: {
    alignItems: "center",
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  resetText: { fontFamily: "SofiaProBold", fontSize: 11 },
  // `gap-2.5 rounded-xl px-2.5 py-2`.
  row: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rowDescription: { fontFamily: "SofiaProReg", fontSize: 11, lineHeight: 14 },
  rowLabel: { fontFamily: "SofiaProBold", fontSize: 13, lineHeight: 16 },
  rowText: { flex: 1, minWidth: 0 },
  rows: { gap: 6 },
  summary: { fontFamily: "SofiaProReg", fontSize: 11, lineHeight: 14 },
  title: { fontFamily: "SofiaProBold", fontSize: 14 },
  // `icon-btn-3d size-9 rounded-full`.
  trigger: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
});
