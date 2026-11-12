// oxlint-disable react/exhaustive-effect-dependencies -- The retry counter intentionally reissues the current topic request.
// Native port of web's `network-panels/topic-picker.tsx`: a search field, a
// breadcrumb while exploring, split suggestion chips (choose on the left,
// explore related topics on the right), a "Finding topics…" line, and an
// "Add" action for a typed topic. The chosen list is rendered by the panel
// with `SettingsPill`, exactly like web, so the picker shows no list of its own.
import { interestSchema, normalizeInterest } from "@asm/protocols/discovery";
import type { NetworkTopic, NetworkTopicPage } from "@asm/protocols/discovery";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react-native";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ZephLoader } from "@/components/feedback/zeph-loader";
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  ORANGE_GRADIENT,
  orangeSurfaceShadows,
  themeText,
} from "@/components/surface/recipes";
import { useSessionContext } from "@/features/auth/state/session";
import { SettingsInput } from "@/features/settings/components/settings-ui";
import { haptic } from "@/lib/interaction/haptics";
import { useAppTheme } from "@/theme";

import { readNetworkTopics } from "../lib/network-api";
import { refreshNetworkSettings } from "../state/use-network-settings";
import { chip3d } from "./network-panels/panel-ui";

function TopicChip({
  chosen,
  chooseDisabled,
  exploreDisabled,
  onChoose,
  onExplore,
  topic,
}: {
  chosen: boolean;
  chooseDisabled: boolean;
  exploreDisabled: boolean;
  onChoose: () => void;
  onExplore: () => void;
  topic: NetworkTopic;
}) {
  const { isDark, theme } = useAppTheme();
  const chip = chip3d(isDark);
  const ink = chosen ? "#ffffff" : themeText(isDark).foreground;
  const content = (
    <View style={styles.chipRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: chooseDisabled, selected: chosen }}
        disabled={chooseDisabled}
        onPress={() => {
          haptic();
          onChoose();
        }}
        style={[styles.chipChoose, chooseDisabled ? styles.disabled : null]}
      >
        <Text
          style={[
            styles.chipText,
            { color: ink, fontFamily: chosen ? "SofiaProMed" : "SofiaProReg" },
          ]}
        >
          {topic.label}
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel={`Explore topics related to ${topic.label}`}
        accessibilityRole="button"
        disabled={exploreDisabled}
        onPress={() => {
          haptic();
          onExplore();
        }}
        style={[
          styles.chipExplore,
          {
            borderLeftColor: chosen
              ? "rgba(255,255,255,0.3)"
              : theme.cardBorder,
          },
          exploreDisabled ? styles.disabled : null,
        ]}
      >
        <ChevronRight color={ink} size={14} />
      </Pressable>
    </View>
  );
  if (chosen) {
    return (
      <Gradient3D
        colors={ORANGE_GRADIENT}
        radius={9999}
        shadows={orangeSurfaceShadows(isDark)}
      >
        {content}
      </Gradient3D>
    );
  }
  return (
    <View
      style={[
        styles.chipShell,
        {
          backgroundColor: chip.background,
          borderColor: chip.border,
          boxShadow: chip.shadows,
        },
      ]}
    >
      {content}
    </View>
  );
}

// shadcn's ghost/outline small buttons, used for retry and "Add".
function TextAction({
  disabled,
  icon,
  label,
  onPress,
  outline = false,
}: {
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  onPress: () => void;
  outline?: boolean;
}) {
  const { isDark, theme } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        haptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.textAction,
        outline
          ? {
              backgroundColor: theme.cardBg,
              borderColor: theme.cardBorder,
              borderWidth: 1,
            }
          : null,
        pressed
          ? {
              backgroundColor: isDark
                ? "rgba(255,255,255,0.08)"
                : "rgba(0,0,0,0.05)",
            }
          : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {icon}
      <Text
        style={[
          styles.textActionLabel,
          { color: themeText(isDark).foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function TopicPicker({
  label,
  selected,
  disabled,
  limit,
  onToggle,
}: {
  label: string;
  selected: string[];
  disabled: boolean;
  limit: number;
  onToggle: (topic: string) => void;
}) {
  const { isDark } = useAppTheme();
  const { user } = useSessionContext();
  const text = themeText(isDark);
  const [search, setSearch] = useState("");
  const [path, setPath] = useState<NetworkTopic[]>([]);
  const [page, setPage] = useState<NetworkTopicPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const parent = path.at(-1);
  const viewerId = user?.id;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      // Web only queries an empty search or one of at least two characters.
      if (search.trim().length === 1) {
        return;
      }
      setLoading(true);
      setFailed(false);
      const read = async () => {
        try {
          const value = await readNetworkTopics(
            search.trim(),
            parent?.source === "wikimedia" ? parent.id : parent?.label,
            controller.signal
          );
          if (!controller.signal.aborted) {
            setPage(value);
            // Exploring teaches the profile, so web refreshes settings after
            // a parent's related topics arrive.
            if (parent && !disabled && viewerId) {
              void refreshNetworkSettings(viewerId, true);
            }
          }
        } catch {
          if (!controller.signal.aborted) {
            setFailed(true);
          }
        }
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      };
      void read();
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `disabled` and the viewer are read at fetch time on purpose: a save
    // toggling `disabled` must not refetch the suggestions.
  }, [search, parent, attempt, disabled, viewerId]);

  const parsed = interestSchema.safeParse(search);
  const choices = page?.items ?? [];
  const canAdd =
    parsed.success &&
    !selected.includes(parsed.data) &&
    !choices.some((entry) => normalizeInterest(entry.label) === parsed.data);

  return (
    <View style={styles.root}>
      <SettingsInput
        hideLabel
        label={label}
        maxLength={64}
        onChangeText={setSearch}
        placeholder="Search topics…"
        value={search}
      />
      {path.length && !search ? (
        <View style={styles.breadcrumb}>
          <Pressable
            accessibilityLabel="Back to parent topics"
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => {
              haptic();
              setPath((value) => value.slice(0, -1));
            }}
            style={styles.breadcrumbBack}
          >
            <ChevronLeft color={text.foreground} size={16} />
          </Pressable>
          <Text
            numberOfLines={1}
            style={[styles.breadcrumbText, { color: text.muted }]}
          >
            {path.map((entry) => entry.label).join(" / ")}
          </Text>
        </View>
      ) : null}
      <View accessibilityLabel={`${label} suggestions`} style={styles.chips}>
        {choices.map((entry) => {
          const value = normalizeInterest(entry.label);
          const chosen = selected.includes(value);
          return (
            <TopicChip
              chooseDisabled={disabled || (!chosen && selected.length >= limit)}
              chosen={chosen}
              exploreDisabled={path.some(
                (ancestor) => ancestor.id === entry.id
              )}
              key={entry.id}
              onChoose={() => onToggle(value)}
              onExplore={() => {
                setPath((current) => [...current, entry]);
                setSearch("");
              }}
              topic={entry}
            />
          );
        })}
      </View>
      {loading ? (
        <View accessibilityLiveRegion="polite" style={styles.finding}>
          <ZephLoader color={text.muted} size="small" variant="general" />
          <Text style={[styles.note, { color: text.muted }]}>
            Finding topics…
          </Text>
        </View>
      ) : null}
      {failed ? (
        <View style={styles.actionRow}>
          <TextAction
            label="Retry topic suggestions"
            onPress={() => setAttempt((value) => value + 1)}
          />
        </View>
      ) : null}
      {canAdd && parsed.success ? (
        <View style={styles.actionRow}>
          <TextAction
            disabled={disabled || selected.length >= limit}
            icon={<Plus color={text.foreground} size={14} />}
            label={`Add “${parsed.data}”`}
            onPress={() => {
              onToggle(parsed.data);
              setSearch("");
            }}
            outline
          />
        </View>
      ) : null}
      {!loading && !failed && page && choices.length === 0 ? (
        <Text style={[styles.note, { color: text.muted }]}>
          No suggestions found. You can add your own topic.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: { alignItems: "flex-start" },
  breadcrumb: { alignItems: "center", flexDirection: "row", gap: 8 },
  breadcrumbBack: {
    alignItems: "center",
    borderRadius: 8,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  breadcrumbText: { flex: 1, fontFamily: "SofiaProReg", fontSize: 14 },
  chipChoose: { paddingHorizontal: 12, paddingVertical: 6 },
  chipExplore: {
    borderLeftWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  chipRow: { alignItems: "center", flexDirection: "row" },
  chipShell: { borderRadius: 9999, borderWidth: 1, overflow: "hidden" },
  chipText: { fontSize: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  disabled: { opacity: 0.5 },
  finding: { alignItems: "center", flexDirection: "row", gap: 8 },
  note: { fontFamily: "SofiaProReg", fontSize: 12 },
  root: { gap: 12 },
  textAction: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
  },
  textActionLabel: { fontFamily: "SofiaProMed", fontSize: 14 },
});
