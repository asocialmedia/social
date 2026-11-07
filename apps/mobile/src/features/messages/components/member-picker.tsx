// The picker of messageable people, shared by creating a den and adding
// people to an existing one. Ported from
// apps/web/src/components/messages/member-picker.tsx: den context always,
// recents (people you already chat with) when idle, search when typing, with
// banned rows shown and labelled rather than hidden, and a ceiling that kills
// unselected rows while leaving picked rows live.
//
// The one native difference: recents come from `fetchRecentDenPeople` (already
// deduped and eligibility-enriched, capped at 8) instead of an inline
// conversation scan with a separate eligibility read.
import { Check, Search, UserPlus } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { premiumInput } from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import {
  fetchRecentDenPeople,
  searchMessageUsers,
} from "@/features/messages/lib/client";
import {
  dedupePickerCandidates,
  pickerRowState,
  toPickerPerson,
} from "@/features/messages/lib/member-picker-rules";
import type { PickerPerson } from "@/features/messages/lib/member-picker-rules";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

export function MemberPickerSearch({
  onChange,
  placeholder,
  value,
}: {
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const { isDark } = useAppTheme();
  const field = premiumInput(isDark, false);
  return (
    <View
      style={[
        styles.search,
        {
          backgroundColor: field.background,
          boxShadow: field.shadows,
        },
      ]}
    >
      <Search color={field.placeholder} size={16} />
      <TextInput
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={field.placeholder}
        style={[styles.searchInput, { color: field.text }]}
        value={value}
      />
    </View>
  );
}

export function MemberPicker({
  bannedIds,
  disabled = false,
  excludeIds,
  maxSelected = null,
  onToggle,
  query,
  selectedIds,
  userId,
}: {
  bannedIds?: readonly string[];
  disabled?: boolean;
  // Ids that cannot be picked: the reader themselves, and the roster already
  // in the den when adding. Filtered out rather than greyed.
  excludeIds?: readonly string[];
  // A ceiling on the selection, so the picker cannot propose a roster the
  // server will refuse. Null means no opinion.
  maxSelected?: number | null;
  onToggle: (person: PickerPerson) => void;
  // The picker's own query, held by the caller beside MemberPickerSearch.
  query: string;
  selectedIds: readonly string[];
  userId: string | null;
}) {
  const { theme } = useAppTheme();
  const [people, setPeople] = useState<PickerPerson[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const excluded = useMemo(() => {
    const ids = new Set(excludeIds);
    if (userId) {
      ids.add(userId);
    }
    return ids;
  }, [excludeIds, userId]);
  const banned = useMemo(() => new Set(bannedIds), [bannedIds]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      // While the request is out, the previous query's people stay in state,
      // so they are withheld until it lands rather than painted as results.
      // Set inside the timeout (not the effect body) so the effect itself
      // stays free of synchronous state writes.
      if (active && query.trim()) {
        setSearching(true);
      }
      try {
        const options = {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        };
        let found: PickerPerson[];
        if (query.trim()) {
          const results = await searchMessageUsers(
            query.trim(),
            options,
            "den"
          );
          found = results.map(toPickerPerson);
        } else {
          const recents = await fetchRecentDenPeople(userId ?? "", options);
          found = recents.map(toPickerPerson);
        }
        // Raw rows; exclusion and dedupe happen at render so picking somebody
        // (which changes `excludeIds`) filters immediately without refetching.
        if (active) {
          setPeople(found);
          setError(null);
        }
      } catch {
        if (active) {
          setError("Couldn't find people. Try again.");
        }
      }
      if (active) {
        setSearching(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, userId]);

  const isSearchMode = query.trim().length > 0;
  const atCeiling = maxSelected !== null && selectedIds.length >= maxSelected;
  // A search can surface somebody the recents excluded (an existing member, or
  // the reader). They cannot be picked twice, so they are filtered here.
  const rows = isSearchMode
    ? people.filter((person) => !excluded.has(person.id))
    : dedupePickerCandidates(people, excluded, 8);

  const renderRow = (person: PickerPerson) => {
    const isSelected = selected.has(person.id);
    const state = pickerRowState({
      addRefusal: person.addRefusal,
      atCeiling,
      banned: banned.has(person.id),
      hasIdentity: person.hasIdentity,
      isSelected,
    });
    const rowDisabled = disabled || state.disabled;
    let rowLabel = `Select ${person.displayName}`;
    if (state.reason) {
      rowLabel = `${person.displayName}, @${person.username}, ${state.reason}`;
    } else if (isSelected) {
      rowLabel = `${person.displayName} selected`;
    }
    return (
      <Pressable
        accessibilityLabel={rowLabel}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isSelected, disabled: rowDisabled }}
        disabled={rowDisabled}
        key={person.id}
        onPress={() => onToggle(person)}
        style={[styles.row, rowDisabled && styles.rowDisabled]}
      >
        <UserAvatar size={34} url={person.avatarUrl} userId={person.id} />
        <View style={styles.rowText}>
          <Text
            numberOfLines={1}
            style={[styles.rowName, { color: theme.inputText }]}
          >
            {person.displayName}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.rowSub, { color: theme.dividerText }]}
          >
            {state.reason
              ? `@${person.username} — ${state.reason}`
              : `@${person.username}`}
          </Text>
        </View>
        {isSelected ? (
          <Check color="#ff9500" size={16} />
        ) : (
          <UserPlus color={theme.dividerText} size={16} />
        )}
      </Pressable>
    );
  };

  if (isSearchMode && searching) {
    return (
      <Text style={[styles.hint, { color: theme.dividerText }]}>
        Searching…
      </Text>
    );
  }
  if (error) {
    return (
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.hint, { color: theme.dividerText }]}
      >
        {error}
      </Text>
    );
  }
  if (isSearchMode && rows.length === 0) {
    return (
      <Text style={[styles.hint, { color: theme.dividerText }]}>
        No one found. Try a different name.
      </Text>
    );
  }
  if (rows.length === 0) {
    return (
      <Text style={[styles.empty, { color: theme.dividerText }]}>
        No conversations yet. Search for anyone to add them.
      </Text>
    );
  }
  return (
    <View style={styles.list}>
      {isSearchMode ? null : (
        <Text style={[styles.section, { color: theme.dividerText }]}>
          People you message
        </Text>
      )}
      {rows.map(renderRow)}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    paddingVertical: 24,
    textAlign: "center",
  },
  hint: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  list: {
    gap: 2,
  },
  row: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowName: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  rowSub: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  search: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    minWidth: 0,
  },
  section: {
    fontFamily: "SofiaProMed",
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    textTransform: "uppercase",
  },
});
