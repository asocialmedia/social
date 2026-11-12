// Native port of web's `settings/network-settings.tsx` at its mobile width.
//
// The hub is one card of four rows (orange mark, title, description, live
// summary, chevron). A row opens its subpage through `?section=`, which keeps
// a deep link or settings search landing on the same page. A subpage leads
// with a round back button beside its section header, then renders the panel
// ported from `network-panels/*`. The back header does not wait for
// preferences, so a slow or failed load never strands the reader.
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  Brain,
  ChevronRight,
  Globe,
  Network,
  Shield,
  Sparkles,
} from "lucide-react-native";
import type { ComponentType, ReactNode, RefObject } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { ScrollViewInstance } from "react-native";

import { AuthPromptCard } from "@/components/auth/auth-prompt-card";
import { themeText } from "@/components/surface/recipes";
import { useSessionContext } from "@/features/auth/state/session";
import { FeedErrorState } from "@/features/feed/components/feed-error-state";
import { SettingsFooterArt } from "@/features/settings/components/settings-footer-art";
import { SettingsCardSkeleton } from "@/features/settings/components/settings-skeleton";
import {
  SettingsButton,
  SettingsCard,
  SettingsIconButton,
  SettingsSectionHeader,
} from "@/features/settings/components/settings-ui";
import { SectionAnchor } from "@/features/settings/lib/settings-scroll";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/layout/scroll-indicator";
import { useAppTheme } from "@/theme";

import {
  NETWORK_SUBPAGES,
  networkSubpageForSection,
  networkSubpageSummary,
} from "../lib/network-subpages";
import type { NetworkSubpage } from "../lib/network-subpages";
import { useNetworkSettings } from "../state/use-network-settings";
import { ContentPanel } from "./network-panels/content-panel";
import { LanguagesPanel } from "./network-panels/languages-panel";
import { ModerationPanel } from "./network-panels/moderation-panel";
import type { NetworkPanelProps } from "./network-panels/panel-props";
import { OrangeMark, PressableRow } from "./network-panels/panel-ui";
import { ProfilesPanel } from "./network-panels/profiles-panel";

// Web keeps the icon on each subpage entry; native's shared entries carry no
// component, so the icons live here.
const SECTION_ICONS: Record<
  NetworkSubpage,
  ComponentType<{ color?: string; size?: number }>
> = {
  content: Sparkles,
  languages: Globe,
  moderation: Shield,
  profiles: Brain,
};

const PANELS: Record<NetworkSubpage, ComponentType<NetworkPanelProps>> = {
  content: ContentPanel,
  languages: LanguagesPanel,
  moderation: ModerationPanel,
  profiles: ProfilesPanel,
};

export function NetworkTab({
  scrollRef,
}: {
  scrollRef: RefObject<ScrollViewInstance | null>;
}) {
  const network = useNetworkSettings({ optimistic: true });
  const { user } = useSessionContext();
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  // A search or settings link names a section anchor; a hub tap names the
  // subpage itself. Unknown sections fall back to the hub.
  const rawSection = params.section ?? "";
  const section =
    networkSubpageForSection(rawSection) ??
    NETWORK_SUBPAGES.find((entry) => entry.id === rawSection)?.id ??
    null;
  const sectionEntry = section
    ? NETWORK_SUBPAGES.find((entry) => entry.id === section)
    : undefined;
  const { catalog, persona, preferences, revision } = network.settings;
  const profile =
    preferences.profiles.find(
      (entry) => entry.id === preferences.activeProfileId
    ) ?? preferences.profiles[0];

  const openSubpage = (next: NetworkSubpage | null) => {
    router.setParams({ section: next ?? "" });
    scrollRef.current?.scrollTo({ animated: false, y: 0 });
  };

  const sectionHeader =
    section && sectionEntry ? (
      <View style={styles.sectionHeader}>
        <SettingsIconButton
          accessibilityLabel="Back to network settings"
          icon={ArrowLeft}
          iconSize={20}
          onPress={() => openSubpage(null)}
          size={40}
        />
        <View style={styles.sectionHeaderCopy}>
          <SettingsSectionHeader
            description={sectionEntry.description}
            icon={SECTION_ICONS[section]}
            title={sectionEntry.title}
          />
        </View>
      </View>
    ) : null;

  let body: ReactNode;
  if (!user) {
    body = (
      <>
        {sectionHeader ?? <HubHeader />}
        <AuthPromptCard title="Sign in to shape your Network" />
      </>
    );
  } else if (!network.ready || !profile) {
    // A failed load still says so and offers a retry; a normal load shows the
    // shape of the pane instead of a spinner.
    body = (
      <>
        {sectionHeader ?? <HubHeader />}
        {network.error ? (
          <FeedErrorState
            isRetrying={network.isFetching}
            message={network.error}
            onRetry={() => {
              void network.refetch();
            }}
          />
        ) : (
          <>
            <SettingsCardSkeleton fields={section ? 2 : 4} />
            {section ? <SettingsCardSkeleton fields={1} /> : null}
          </>
        )}
      </>
    );
  } else if (section) {
    const Panel = PANELS[section];
    body = (
      <>
        {sectionHeader}
        {network.error ? (
          <View style={styles.errorRow}>
            <Text
              accessibilityRole="alert"
              style={[
                styles.error,
                styles.errorText,
                { color: text.destructive },
              ]}
            >
              {network.error}
            </Text>
            <SettingsButton
              label="Retry"
              onPress={() => {
                void network.refetch();
              }}
              size="sm"
              tone="gray"
            />
          </View>
        ) : null}
        <Panel
          catalog={catalog}
          clearActivity={network.clearActivity}
          isSaving={network.isSaving}
          persona={persona}
          preferences={preferences}
          profile={profile}
          revision={revision}
          save={network.save}
        />
      </>
    );
  } else {
    body = (
      <>
        <HubHeader />
        {network.error ? (
          <Text
            accessibilityRole="alert"
            style={[styles.error, { color: text.destructive }]}
          >
            {network.error}
          </Text>
        ) : null}
        <SectionAnchor id="settings-network" tab="network">
          <SettingsCard padded={false} style={styles.hubCard}>
            {NETWORK_SUBPAGES.map((entry) => {
              const summary = networkSubpageSummary(
                entry.id,
                preferences,
                profile.name
              );
              return (
                <PressableRow
                  accessibilityLabel={`${entry.title}. ${entry.description}. ${summary}`}
                  key={entry.id}
                  onPress={() => openSubpage(entry.id)}
                >
                  <OrangeMark icon={SECTION_ICONS[entry.id]} size={40} />
                  <View style={styles.hubCopy}>
                    <Text style={[styles.hubTitle, { color: text.foreground }]}>
                      {entry.title}
                    </Text>
                    <Text
                      style={[styles.hubDescription, { color: text.muted }]}
                    >
                      {entry.description}
                    </Text>
                    <Text style={[styles.hubSummary, { color: text.muted }]}>
                      {summary}
                    </Text>
                  </View>
                  <ChevronRight color={text.foreground} size={20} />
                </PressableRow>
              );
            })}
          </SettingsCard>
        </SectionAnchor>
      </>
    );
  }

  return (
    <ScrollView
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      ref={scrollRef}
      showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
    >
      {body}
      <Text accessibilityLiveRegion="polite" style={styles.srOnly}>
        {network.isSaving ? "Saving network preferences…" : ""}
      </Text>
      <SettingsFooterArt tab="network" />
    </ScrollView>
  );
}

// The hub header sits inset by the card border (1px), the card padding (6px)
// and the row padding (12px), so its mark lines up with the row marks below.
function HubHeader() {
  return (
    <View style={styles.hubHeader}>
      <SettingsSectionHeader
        description="Shape discovery across your networks"
        icon={Network}
        title="Network"
      />
    </View>
  );
}

export function DiscoverySafetyControl() {
  const network = useNetworkSettings();
  const router = useRouter();
  return (
    <SettingsButton
      size="sm"
      tone="gray"
      label={
        network.ready && network.settings.preferences.showExplicitContent
          ? "18+ enabled"
          : "18+ hidden"
      }
      onPress={() =>
        router.push(
          network.viewer === "guest"
            ? "/login"
            : "/settings?tab=network&section=moderation"
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: 18, padding: 16, paddingBottom: 0 },
  error: { fontFamily: "SofiaProReg", fontSize: 14 },
  errorRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  errorText: { flex: 1 },
  // `p-1.5` around the rows, `gap-0.5` between them.
  hubCard: { gap: 2, padding: 6 },
  hubCopy: { flex: 1, minWidth: 0 },
  hubDescription: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  hubHeader: { paddingLeft: 19 },
  hubSummary: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    marginTop: 6,
  },
  hubTitle: { fontFamily: "SofiaProMed", fontSize: 14 },
  sectionHeader: { alignItems: "center", flexDirection: "row", gap: 12 },
  sectionHeaderCopy: { flex: 1, minWidth: 0 },
  // Web's `sr-only` live region: read aloud, never drawn.
  srOnly: { height: 0, opacity: 0, position: "absolute", width: 0 },
});
