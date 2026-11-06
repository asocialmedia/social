import {
  COMMUNITY_POST_RANGES,
  COMMUNITY_POST_RATINGS,
  COMMUNITY_POST_TYPES,
  communityPostFilterCount,
  readCommunityFeedSelection,
} from "@asm/db/communities";
import type { CommunityPostFilters as PostFilters } from "@asm/db/communities";
import { SlidersHorizontal } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { StatusActionButton } from "@/components/feedback/status-action-button";
import { DialogPanel } from "@/components/surface/dialog-panel";
import { metaChip, premiumInput } from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";

export function CommunityPostFilters({
  filters,
  onChange,
}: {
  filters: PostFilters;
  onChange: (filters: PostFilters) => void;
}) {
  const { theme, isDark } = useAppTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const chip = metaChip(isDark);
  const input = premiumInput(isDark, false);
  const count = communityPostFilterCount(filters);
  const inputStyle = [
    styles.input,
    {
      backgroundColor: input.background,
      boxShadow: input.shadows,
      color: input.text,
    },
  ];
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Filter community posts${count ? `, ${count} active` : ""}`}
        onPress={() => {
          setDraft(filters);
          setOpen(true);
        }}
        style={[
          styles.trigger,
          {
            backgroundColor: chip.background,
            borderColor: chip.border,
            boxShadow: chip.shadows,
          },
        ]}
      >
        <SlidersHorizontal size={16} color={theme.inputText} />
        <Text style={{ color: theme.inputText, fontFamily: "SofiaProBold" }}>
          Filters{count ? ` · ${count}` : ""}
        </Text>
      </Pressable>
      {open ? (
        <DialogPanel
          title="Find your kind of post"
          description="Mix filters to explore this community. Uploaded media and link previews have separate filters."
          onClose={() => setOpen(false)}
        >
          {[
            { key: "type", label: "Post type", options: COMMUNITY_POST_TYPES },
            { key: "range", label: "Posted", options: COMMUNITY_POST_RANGES },
            {
              key: "rating",
              label: "Content rating",
              options: COMMUNITY_POST_RATINGS,
            },
          ].map((group) => (
            <View key={group.key} style={styles.group}>
              <Text
                accessibilityRole="header"
                style={[styles.label, { color: theme.inputText }]}
              >
                {group.label}
              </Text>
              <View style={styles.choices}>
                {group.options.map((option) => {
                  const selected =
                    draft[group.key as "type" | "range" | "rating"] ===
                    option.value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${group.label}: ${option.label}`}
                      style={[
                        styles.choice,
                        {
                          backgroundColor: chip.background,
                          borderColor: selected ? theme.inputText : chip.border,
                          boxShadow: chip.shadows,
                        },
                      ]}
                      onPress={() =>
                        setDraft(
                          readCommunityFeedSelection(
                            new URLSearchParams({
                              ...draft,
                              [group.key]: option.value,
                              q: draft.query,
                            })
                          )
                        )
                      }
                    >
                      <Text
                        style={{
                          color: theme.inputText,
                          fontFamily: selected ? "SofiaProBold" : "SofiaProReg",
                        }}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          <Text style={[styles.label, { color: theme.inputText }]}>
            Words in the post
          </Text>
          <TextInput
            accessibilityLabel="Words in the post"
            style={inputStyle}
            maxLength={120}
            value={draft.query}
            onChangeText={(query) => setDraft({ ...draft, query })}
            placeholder="e.g. weekend sketches"
            placeholderTextColor={input.placeholder}
          />
          <Text style={[styles.label, { color: theme.inputText }]}>
            Posted by
          </Text>
          <TextInput
            accessibilityLabel="Posted by"
            style={inputStyle}
            maxLength={64}
            autoCapitalize="none"
            autoCorrect={false}
            value={draft.author}
            onChangeText={(author) => setDraft({ ...draft, author })}
            placeholder="@username"
            placeholderTextColor={input.placeholder}
          />
          <Pressable
            accessibilityRole="button"
            style={styles.reset}
            onPress={() =>
              setDraft(readCommunityFeedSelection(new URLSearchParams()))
            }
          >
            <Text style={{ color: theme.inputText }}>Reset filters</Text>
          </Pressable>
          <StatusActionButton
            label="Show posts"
            onPress={() => {
              onChange(
                readCommunityFeedSelection(
                  new URLSearchParams({ ...draft, q: draft.query })
                )
              );
              setOpen(false);
            }}
          />
        </DialogPanel>
      ) : null}
    </>
  );
}

export function CommunityPostFilterSummary({
  filters,
  onClear,
}: {
  filters: PostFilters;
  onClear: () => void;
}) {
  const { theme } = useAppTheme();
  if (!communityPostFilterCount(filters)) {
    return null;
  }
  const labels = [
    filters.type === "all"
      ? null
      : COMMUNITY_POST_TYPES.find((item) => item.value === filters.type)?.label,
    filters.range === "all"
      ? null
      : COMMUNITY_POST_RANGES.find((item) => item.value === filters.range)
          ?.label,
    filters.rating === "all"
      ? null
      : COMMUNITY_POST_RATINGS.find((item) => item.value === filters.rating)
          ?.label,
    filters.query ? `“${filters.query}”` : null,
    filters.author ? `@${filters.author}` : null,
  ].filter(Boolean);
  return (
    <View style={styles.summary}>
      <Text style={[styles.summaryText, { color: theme.dividerText }]}>
        {labels.join(" · ")}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Clear post filters"
        onPress={onClear}
        style={styles.reset}
      >
        <Text style={{ color: theme.inputText }}>Clear filters</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  choice: {
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 14,
  },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  group: { marginBottom: 20 },
  input: {
    borderRadius: 12,
    fontFamily: "SofiaProReg",
    fontSize: 16,
    marginBottom: 16,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  label: { fontFamily: "SofiaProBold", fontSize: 14, marginBottom: 8 },
  reset: { justifyContent: "center", minHeight: 48, paddingHorizontal: 8 },
  summary: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
  },
  summaryText: { flex: 1, fontFamily: "SofiaProReg", fontSize: 12 },
  trigger: {
    alignItems: "center",
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 14,
  },
});
