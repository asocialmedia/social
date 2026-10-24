import { Host, Picker, Switch } from "@expo/ui";
import { randomUUID } from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  Brain,
  Globe,
  Network,
  Shield,
  Sparkles,
} from "lucide-react-native";
import { useMemo, useState } from "react";
import type { RefObject } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import type { ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AuthPromptCard } from "@/components/auth/auth-prompt-card";
import { useSessionContext } from "@/features/auth/state/session";
import {
  SettingsButton,
  SettingsCard,
  SettingsCardHeading,
  SettingsInput,
  SettingsSectionHeader,
} from "@/features/settings/components/settings-ui";
import { SectionAnchor } from "@/features/settings/lib/settings-scroll";
import { useAppTheme } from "@/theme";

import {
  networkDisplayNames,
  networkLocaleChoices,
} from "../lib/display-names";
import { useNetworkSettings } from "../state/use-network-settings";
import { TopicPicker } from "./topic-picker";

const SECTIONS = [
  {
    description: "Independent interests and learning",
    icon: Brain,
    id: "profiles",
    title: "Profiles",
  },
  {
    description: "Interests, activity and topic connections",
    icon: Sparkles,
    id: "content",
    title: "Content & media",
  },
  {
    description: "Sensitive media and topics to avoid",
    icon: Shield,
    id: "moderation",
    title: "Moderation & content filters",
  },
  {
    description: "Content languages and regional preferences",
    icon: Globe,
    id: "languages",
    title: "Languages",
  },
] as const;
const SECTION_TARGETS: Record<string, string> = {
  "settings-network-activity": "content",
  "settings-network-avoid": "moderation",
  "settings-network-explicit": "moderation",
  "settings-network-interests": "content",
  "settings-network-profiles": "profiles",
  "settings-network-region": "languages",
};

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
  const section = SECTION_TARGETS[params.section ?? ""] ?? params.section;
  const panel = SECTIONS.find((entry) => entry.id === section);
  const [name, setName] = useState("");
  const [languageSearch, setLanguageSearch] = useState("");
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
        icon={panel?.icon ?? Network}
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
        <ActivityIndicator color={theme.dividerText} />
      ) : null}
      {user && network.ready && profile ? (
        <>
          {panel ? null : (
            <SettingsCard>
              {SECTIONS.map((entry) => (
                <SettingsButton
                  key={entry.id}
                  label={`${entry.title} →`}
                  leadingIcon={entry.icon}
                  tone="gray"
                  onPress={() => {
                    router.setParams({ section: entry.id });
                    scrollRef.current?.scrollTo({ y: 0 });
                  }}
                />
              ))}
              <Text style={{ color: theme.dividerText }}>
                {profile.name} · {profile.interests.length} interests ·{" "}
                {preferences.showExplicitContent ? "18+ enabled" : "18+ hidden"}
              </Text>
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
                  <Host matchContents>
                    <Switch
                      label="Show explicit content (18+)"
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
                  </Host>
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
                <SettingsInput
                  label="Find a language"
                  value={languageSearch}
                  onChangeText={setLanguageSearch}
                />
                <View className="flex-row flex-wrap gap-2">
                  {languages
                    .filter((entry) =>
                      `${entry.code} ${entry.label}`
                        .toLowerCase()
                        .includes(languageSearch.toLowerCase())
                    )
                    .map(({ code }) => {
                      const selected =
                        preferences.contentLanguages.includes(code);
                      return (
                        <SettingsButton
                          key={code}
                          size="sm"
                          tone={selected ? "primary" : "gray"}
                          disabled={disabled}
                          label={`${selected ? "✓ " : ""}${names.language.of(code) ?? code}`}
                          onPress={() => {
                            void save({
                              ...preferences,
                              contentLanguages: selected
                                ? preferences.contentLanguages.filter(
                                    (entry) => entry !== code
                                  )
                                : [...preferences.contentLanguages, code],
                              language: "en",
                            });
                          }}
                        />
                      );
                    })}
                </View>
                <Text style={{ color: theme.dividerText }}>
                  Regional content
                </Text>
                <Host matchContents>
                  <Picker
                    selectedValue={preferences.region}
                    enabled={!disabled}
                    onValueChange={(region) => {
                      void save({ ...preferences, region });
                    }}
                  >
                    <Picker.Item value="auto" label="Device region" />
                    <Picker.Item value="all" label="No regional preference" />
                    {regions.map((entry) => (
                      <Picker.Item
                        key={entry.code}
                        value={entry.code}
                        label={entry.label}
                      />
                    ))}
                  </Picker>
                </Host>
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
