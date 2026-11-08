import { randomUUID } from "expo-crypto";
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
import { useMemo, useState } from "react";
import type { RefObject } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AuthPromptCard } from "@/components/auth/auth-prompt-card";
import { Spinner3D } from "@/components/feedback/spinner-3d";
import { useSessionContext } from "@/features/auth/state/session";
import { SettingsFooterArt } from "@/features/settings/components/settings-footer-art";
import {
  SettingsButton,
  SettingsCard,
  SettingsCardHeading,
  SettingsInput,
  SettingsSectionHeader,
  SettingsSwitch,
} from "@/features/settings/components/settings-ui";
import { SectionAnchor } from "@/features/settings/lib/settings-scroll";
import { useAppTheme } from "@/theme";

import {
  networkDisplayNames,
  networkLocaleChoices,
} from "../lib/display-names";
import {
  contentRegionLabel,
  toggleContentLanguage,
} from "../lib/locale-selection";
import {
  NETWORK_SUBPAGES,
  networkSubpageForSection,
  networkSubpageSummary,
} from "../lib/network-subpages";
import { useNetworkSettings } from "../state/use-network-settings";
import { NetworkLocalePicker } from "./network-locale-picker";
import { TopicPicker } from "./topic-picker";

const SECTION_ICONS = {
  content: Sparkles,
  languages: Globe,
  moderation: Shield,
  profiles: Brain,
} as const;

export function NetworkTab({
  scrollRef,
}: {
  scrollRef: RefObject<ScrollViewInstance | null>;
}) {
  const network = useNetworkSettings();
  const { user } = useSessionContext();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  // A search or settings link names a section; a direct hub tap names the
  // subpage itself. Unknown sections fall back to the hub.
  const rawSection = params.section ?? "";
  const section =
    networkSubpageForSection(rawSection) ??
    (NETWORK_SUBPAGES.some((entry) => entry.id === rawSection)
      ? rawSection
      : "");
  const panel = NETWORK_SUBPAGES.find((entry) => entry.id === section);
  const [name, setName] = useState("");
  const [localePicker, setLocalePicker] = useState<
    "languages" | "regions" | null
  >(null);
  const { preferences, persona } = network.settings;
  const profile =
    preferences.profiles.find(
      (entry) => entry.id === preferences.activeProfileId
    ) ?? preferences.profiles[0];
  const names = useMemo(() => networkDisplayNames(), []);
  const languages = useMemo(
    () => networkLocaleChoices(names.language, "language"),
    [names]
  );
  const regions = useMemo(
    () => networkLocaleChoices(names.region, "region"),
    [names]
  );
  const { save } = network;
  const regionLabel = contentRegionLabel(preferences.region, (code) =>
    names.region.of(code)
  );
  const selectedLanguages = preferences.contentLanguages.length
    ? preferences.contentLanguages
    : ["all"];
  const panelIcon = panel ? SECTION_ICONS[panel.id] : Network;
  const disabled = network.isSaving || !network.ready;
  const updateInterests = (topic: string) => {
    if (!profile) {
      return;
    }
    const interests = profile.interests.includes(topic)
      ? profile.interests.filter((entry) => entry !== topic)
      : [...profile.interests, topic].slice(0, 32);
    void save({
      ...preferences,
      profiles: preferences.profiles.map((entry) =>
        entry.id === profile.id ? { ...entry, interests } : entry
      ),
    });
  };
  return (
    <ScrollView
      ref={scrollRef}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        gap: 16,
        padding: 16,
        paddingBottom: 96 + insets.bottom,
      }}
    >
      {panel ? (
        <SettingsButton
          tone="gray"
          leadingIcon={ArrowLeft}
          label="Back to Network"
          onPress={() => {
            router.setParams({ section: "" });
            scrollRef.current?.scrollTo({ y: 0 });
          }}
        />
      ) : null}
      <SettingsSectionHeader
        title={panel?.title ?? "Network"}
        description={
          panel?.description ?? "Shape discovery across your networks"
        }
        icon={panelIcon}
      />
      {user ? null : <AuthPromptCard title="Sign in to shape your Network" />}
      {network.error ? (
        <SettingsCard>
          <Text selectable style={{ color: theme.inputText }}>
            {network.error}
          </Text>
          <SettingsButton
            label="Retry Network settings"
            tone="gray"
            onPress={() => {
              void network.refetch();
            }}
          />
        </SettingsCard>
      ) : null}
      {user && !network.ready && !network.error ? (
        <Spinner3D size={24} />
      ) : null}
      {user && network.ready && profile ? (
        <>
          {panel ? null : (
            <SettingsCard>
              {NETWORK_SUBPAGES.map((entry) => {
                const EntryIcon = SECTION_ICONS[entry.id];
                return (
                  <Pressable
                    accessibilityLabel={`${entry.title}: ${networkSubpageSummary(entry.id, preferences, profile.name)}`}
                    accessibilityRole="button"
                    hitSlop={4}
                    key={entry.id}
                    onPress={() => {
                      router.setParams({ section: entry.id });
                      scrollRef.current?.scrollTo({ y: 0 });
                    }}
                    style={styles.hubRow}
                  >
                    <View
                      style={[
                        styles.hubIcon,
                        { backgroundColor: theme.cardBg },
                      ]}
                    >
                      <EntryIcon color="#ff9500" size={20} />
                    </View>
                    <View style={styles.hubCopy}>
                      <Text
                        style={[styles.hubTitle, { color: theme.inputText }]}
                      >
                        {entry.title}
                      </Text>
                      <Text
                        style={[
                          styles.hubDescription,
                          { color: theme.dividerText },
                        ]}
                      >
                        {entry.description}
                      </Text>
                      <Text
                        style={[
                          styles.hubSummary,
                          { color: theme.dividerText },
                        ]}
                      >
                        {networkSubpageSummary(
                          entry.id,
                          preferences,
                          profile.name
                        )}
                      </Text>
                    </View>
                    <ChevronRight color={theme.dividerText} size={20} />
                  </Pressable>
                );
              })}
            </SettingsCard>
          )}
          {panel?.id === "profiles" ? (
            <SectionAnchor id="settings-network-profiles" tab="network">
              <SettingsCard>
                <SettingsCardHeading
                  icon={Brain}
                  title="Recommendation profiles"
                  description="Each profile keeps its own interests and recent activity."
                />
                <View className="flex-row flex-wrap gap-2">
                  {preferences.profiles.map((entry) => (
                    <SettingsButton
                      key={entry.id}
                      label={`${entry.id === profile.id ? "✓ " : ""}${entry.name}`}
                      tone={entry.id === profile.id ? "primary" : "gray"}
                      disabled={disabled}
                      onPress={() => {
                        void save({
                          ...preferences,
                          activeProfileId: entry.id,
                        });
                      }}
                    />
                  ))}
                </View>
                <SettingsInput
                  label="New profile name"
                  maxLength={40}
                  value={name}
                  onChangeText={setName}
                />
                <SettingsButton
                  label="Create profile"
                  disabled={
                    disabled || !name.trim() || preferences.profiles.length >= 8
                  }
                  onPress={() => {
                    const next = {
                      id: randomUUID(),
                      interests: [],
                      name: name.trim(),
                    };
                    const createProfile = async () => {
                      const saved = await save({
                        ...preferences,
                        activeProfileId: next.id,
                        profiles: [...preferences.profiles, next],
                      });
                      if (saved) {
                        setName("");
                      }
                    };
                    void createProfile();
                  }}
                />
                <SettingsButton
                  label={`Delete ${profile.name}`}
                  tone="danger"
                  disabled={disabled || preferences.profiles.length === 1}
                  onPress={() =>
                    Alert.alert(
                      "Delete recommendation profile?",
                      "Its interests and learning will be removed.",
                      [
                        { style: "cancel", text: "Cancel" },
                        {
                          onPress: () => {
                            const profiles = preferences.profiles.filter(
                              (entry) => entry.id !== profile.id
                            );
                            void save({
                              ...preferences,
                              activeProfileId: profiles[0]?.id ?? "default",
                              profiles,
                            });
                          },
                          style: "destructive",
                          text: "Delete",
                        },
                      ]
                    )
                  }
                />
              </SettingsCard>
            </SectionAnchor>
          ) : null}
          {panel?.id === "content" ? (
            <>
              <SectionAnchor id="settings-network-interests" tab="network">
                <SettingsCard>
                  <SettingsCardHeading
                    icon={Sparkles}
                    title={`Interests · ${profile.interests.length} of 32`}
                    description={`What ${profile.name} wants to discover`}
                  />
                  <TopicPicker
                    label="Find or add an interest"
                    selected={profile.interests}
                    disabled={disabled}
                    limit={32}
                    onToggle={updateInterests}
                  />
                  <View
                    accessibilityLabel="Chosen interests"
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                  >
                    {profile.interests.map((topic) => (
                      <SettingsButton
                        key={topic}
                        label={`${topic} ×`}
                        tone="gray"
                        size="sm"
                        disabled={disabled}
                        onPress={() => updateInterests(topic)}
                      />
                    ))}
                  </View>
                </SettingsCard>
              </SectionAnchor>
              <SectionAnchor id="settings-network-activity" tab="network">
                <SettingsCard>
                  <SettingsCardHeading
                    icon={Brain}
                    title={`Recent activity · ${persona.signalCount} interactions`}
                    description="Your chosen interests stay when learning is cleared."
                  />
                  <Text selectable style={{ color: theme.inputText }}>
                    {persona.learnedInterests.join(" · ") ||
                      "No recent activity for this profile."}
                  </Text>
                  <SettingsButton
                    label="Clear recent activity"
                    tone="gray"
                    disabled={disabled}
                    onPress={() =>
                      Alert.alert(
                        "Clear recent activity?",
                        "This profile will start learning again. Your interests and connected accounts stay.",
                        [
                          { style: "cancel", text: "Cancel" },
                          {
                            onPress: () => {
                              void network.clearActivity();
                            },
                            text: "Clear",
                          },
                        ]
                      )
                    }
                  />
                </SettingsCard>
              </SectionAnchor>
              <SectionAnchor id="settings-network-connections" tab="network">
                <SettingsCard>
                  <SettingsCardHeading
                    icon={Network}
                    title="Topic connections"
                    description="Related subjects discovered from this profile"
                  />
                  <Text selectable style={{ color: theme.inputText }}>
                    {persona.relatedInterests.join(" · ") ||
                      "Connections appear as you choose interests and browse."}
                  </Text>
                </SettingsCard>
              </SectionAnchor>
            </>
          ) : null}
          {panel?.id === "moderation" ? (
            <>
              <SectionAnchor id="settings-network-explicit" tab="network">
                <SettingsCard>
                  <SettingsCardHeading
                    icon={Shield}
                    title="Explicit content"
                    description="Off by default. Applies to every profile, Home, Explore and Gusts."
                  />
                  <View
                    style={{
                      alignItems: "center",
                      flexDirection: "row",
                      gap: 12,
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={{ color: theme.inputText }}>
                      Show explicit content (18+)
                    </Text>
                    <SettingsSwitch
                      accessibilityLabel="Show explicit content (18+)"
                      disabled={disabled}
                      value={preferences.showExplicitContent}
                      onValueChange={(value) => {
                        if (value) {
                          Alert.alert(
                            "Enable explicit content?",
                            "Enable only if you are 18 or older. Media warnings still appear before revealing content.",
                            [
                              { style: "cancel", text: "Cancel" },
                              {
                                onPress: () => {
                                  void save({
                                    ...preferences,
                                    showExplicitContent: true,
                                  });
                                },
                                text: "I'm 18 or older",
                              },
                            ]
                          );
                        } else {
                          void save({
                            ...preferences,
                            showExplicitContent: false,
                          });
                        }
                      }}
                    />
                  </View>
                </SettingsCard>
              </SectionAnchor>
              <SectionAnchor id="settings-network-avoid" tab="network">
                <SettingsCard>
                  <SettingsCardHeading
                    icon={Shield}
                    title="Not interested"
                    description="Avoid matching topics and compound tags across your feeds."
                  />
                  <TopicPicker
                    label="Topic to avoid"
                    selected={preferences.avoidedTopics}
                    disabled={disabled}
                    limit={64}
                    onToggle={(topic) => {
                      void save({
                        ...preferences,
                        avoidedTopics: preferences.avoidedTopics.includes(topic)
                          ? preferences.avoidedTopics.filter(
                              (entry) => entry !== topic
                            )
                          : [...preferences.avoidedTopics, topic].slice(0, 64),
                      });
                    }}
                  />
                  <View
                    accessibilityLabel="Avoided topics"
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                  >
                    {preferences.avoidedTopics.map((topic) => (
                      <SettingsButton
                        key={topic}
                        label={`${topic} ×`}
                        tone="gray"
                        size="sm"
                        disabled={disabled}
                        onPress={() => {
                          void save({
                            ...preferences,
                            avoidedTopics: preferences.avoidedTopics.filter(
                              (entry) => entry !== topic
                            ),
                          });
                        }}
                      />
                    ))}
                  </View>
                  <Text style={{ color: theme.dividerText }}>
                    {persona.avoidedTopics.length
                      ? `Showing less: ${persona.avoidedTopics.join(", ")}`
                      : "No learned exclusions for this profile."}
                  </Text>
                </SettingsCard>
              </SectionAnchor>
            </>
          ) : null}
          {panel?.id === "languages" ? (
            <SectionAnchor id="settings-network-region" tab="network">
              <SettingsCard>
                <SettingsCardHeading
                  icon={Globe}
                  title="Content languages"
                  description="Choose multiple languages, follow your device, or allow every language."
                />
                <SettingsButton
                  label="Use device language"
                  tone="gray"
                  disabled={disabled}
                  onPress={() => {
                    const language =
                      Intl.DateTimeFormat()
                        .resolvedOptions()
                        .locale.split("-")[0] ?? "en";
                    void save({
                      ...preferences,
                      contentLanguages: [...new Set(["en", language])],
                      language: "auto",
                    });
                  }}
                />
                <SettingsButton
                  label="All languages"
                  tone="gray"
                  disabled={disabled}
                  onPress={() => {
                    void save({
                      ...preferences,
                      contentLanguages: [],
                      language: "all",
                    });
                  }}
                />
                <SettingsButton
                  label={
                    preferences.contentLanguages.length
                      ? preferences.contentLanguages
                          .map((code) => names.language.of(code) ?? code)
                          .join(", ")
                      : "All languages"
                  }
                  tone="gray"
                  disabled={disabled}
                  onPress={() => setLocalePicker("languages")}
                />
                <Text style={{ color: theme.dividerText }}>
                  Regional content
                </Text>
                <SettingsButton
                  label={regionLabel}
                  tone="gray"
                  disabled={disabled}
                  onPress={() => setLocalePicker("regions")}
                />

                <Text style={{ color: theme.dividerText }}>
                  Regional relevance is a preference. Feeds stay global when
                  local candidates are unavailable.
                </Text>
              </SettingsCard>
            </SectionAnchor>
          ) : null}
          {network.isSaving ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: theme.dividerText }}
            >
              Saving Network settings…
            </Text>
          ) : null}
        </>
      ) : null}
      <SettingsFooterArt tab="network" />
      {localePicker ? (
        <NetworkLocalePicker
          multiple={localePicker === "languages"}
          title={
            localePicker === "languages"
              ? "Content languages"
              : "Regional content"
          }
          options={
            localePicker === "languages"
              ? [{ code: "all", label: "All languages" }, ...languages]
              : [
                  { code: "auto", label: "Device region" },
                  { code: "all", label: "No regional preference" },
                  ...regions,
                ]
          }
          selected={
            localePicker === "languages"
              ? selectedLanguages
              : [preferences.region]
          }
          disabled={disabled}
          onClose={() => setLocalePicker(null)}
          onSelect={(code) => {
            if (localePicker === "regions") {
              void save({ ...preferences, region: code });
              setLocalePicker(null);
            } else {
              void save({
                ...preferences,
                contentLanguages: toggleContentLanguage(
                  preferences.contentLanguages,
                  code
                ),
                language: "en",
              });
            }
          }}
        />
      ) : null}
    </ScrollView>
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
  hubCopy: {
    flex: 1,
    minWidth: 0,
  },
  hubDescription: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    marginTop: 2,
  },
  hubIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  hubRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  hubSummary: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
    marginTop: 6,
  },
  hubTitle: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
});
