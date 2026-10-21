// oxlint-disable react/exhaustive-effect-dependencies -- The retry counter intentionally reissues the current topic request.
import { interestSchema, normalizeInterest } from "@asm/protocols/discovery";
import type { NetworkTopic, NetworkTopicPage } from "@asm/protocols/discovery";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import {
  SettingsButton,
  SettingsInput,
} from "@/features/settings/components/settings-ui";
import { useAppTheme } from "@/theme";

import { readNetworkTopics } from "../lib/network-api";

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
  const { theme } = useAppTheme();
  const [search, setSearch] = useState("");
  const [path, setPath] = useState<NetworkTopic[]>([]);
  const [page, setPage] = useState<NetworkTopicPage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const parent = path.at(-1);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (search.trim().length === 1) {
        setPage(null);
        return;
      }
      setLoading(true);
      setErrorMessage(null);
      const read = async () => {
        try {
          const value = await readNetworkTopics(
            search,
            parent?.source === "wikimedia" ? parent.id : parent?.label,
            controller.signal
          );
          if (!controller.signal.aborted) {
            setPage(value);
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            setErrorMessage(
              error instanceof Error ? error.message : "Couldn't load topics"
            );
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
  }, [search, parent, attempt]);
  const parsed = interestSchema.safeParse(search);
  return (
    <View className="gap-3">
      <SettingsInput
        label={label}
        maxLength={64}
        onChangeText={setSearch}
        value={search}
        placeholder="Search topics…"
      />
      {path.length ? (
        <SettingsButton
          tone="gray"
          label={`Back · ${parent?.label}`}
          onPress={() => {
            setPath((value) => value.slice(0, -1));
            setSearch("");
          }}
        />
      ) : null}
      {loading ? <ActivityIndicator color={theme.dividerText} /> : null}
      {errorMessage ? (
        <>
          <Text selectable style={{ color: theme.dividerText }}>
            {errorMessage}
          </Text>
          <SettingsButton
            tone="gray"
            label="Retry topics"
            onPress={() => setAttempt((value) => value + 1)}
          />
        </>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {page?.items.map((topic) => {
          const value = normalizeInterest(topic.label);
          const chosen = selected.includes(value);
          return (
            <View key={topic.id} className="flex-row gap-1">
              <SettingsButton
                label={`${chosen ? "✓ " : "+ "}${topic.label}`}
                size="sm"
                tone={chosen ? "primary" : "gray"}
                disabled={disabled || (!chosen && selected.length >= limit)}
                onPress={() => onToggle(value)}
              />
              <SettingsButton
                label={`Explore ${topic.label}`}
                size="sm"
                tone="gray"
                onPress={() => {
                  setPath((entries) => [...entries, topic]);
                  setSearch("");
                }}
              />
            </View>
          );
        })}
      </View>
      {parsed.success && !selected.includes(parsed.data) ? (
        <SettingsButton
          label={`Add “${parsed.data}”`}
          disabled={disabled || selected.length >= limit}
          onPress={() => {
            onToggle(parsed.data);
            setSearch("");
          }}
        />
      ) : null}
      {!loading && page?.items.length === 0 ? (
        <Text style={{ color: theme.dividerText }}>
          No suggestions. Try another topic or add your own.
        </Text>
      ) : null}
      {page?.partial ? (
        <Text style={{ color: theme.dividerText }}>
          Some topic sources are unavailable. You can still choose these topics.
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {selected.map((topic) => (
          <SettingsButton
            key={topic}
            label={`${topic} ×`}
            size="sm"
            tone="gray"
            disabled={disabled}
            onPress={() => onToggle(topic)}
          />
        ))}
      </View>
    </View>
  );
}
