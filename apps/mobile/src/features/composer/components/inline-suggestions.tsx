// @mention / #tag suggestion list, port of web's inline-suggestions: while
// the caret sits in an `@query` / `#query`, a 256px card lists up to six
// matches (GET /api/users/search?q= or /api/tags?q=, 250ms debounce, stale
// responses dropped), "Searching..." while loading and "No matching users"
// / "No matching tags" when empty. Already-picked entries are excluded.
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { themeText } from "@/components/surface/recipes";
import { apiJson } from "@/features/media-upload/lib/upload-api";
import { useAppTheme } from "@/theme";

import type { ActiveTrigger, MentionPick } from "../lib/inline-relations";

const MAX_SUGGESTIONS = 6;

interface SearchUser {
  avatarUrl: string | null;
  displayName?: string | null;
  id: string;
  username: string;
}

export function InlineSuggestions({
  active,
  excludedTags,
  excludedUserIds,
  onPickTag,
  onPickUser,
}: {
  active: ActiveTrigger | null;
  excludedTags: readonly string[];
  excludedUserIds: readonly string[];
  onPickTag: (tag: string) => void;
  onPickUser: (user: MentionPick) => void;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const [users, setUsers] = useState<SearchUser[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const latestQuery = useRef("");

  const trigger = active?.trigger ?? null;
  const query = active?.query ?? "";

  useEffect(() => {
    if (!trigger) {
      return;
    }
    const key = `${trigger}${query}`;
    latestQuery.current = key;
    const timer = setTimeout(() => {
      setLoading(true);
      void (async () => {
        try {
          if (trigger === "@") {
            const data = await apiJson<{ users?: SearchUser[] }>(
              `/api/users/search?q=${encodeURIComponent(query)}`
            );
            if (latestQuery.current === key) {
              setUsers(
                (data.users ?? [])
                  .filter((user) => !excludedUserIds.includes(user.id))
                  .slice(0, MAX_SUGGESTIONS)
              );
            }
          } else {
            const data = await apiJson<{ tags?: string[] }>(
              `/api/tags?q=${encodeURIComponent(query)}`
            );
            if (latestQuery.current === key) {
              setTags(
                (data.tags ?? [])
                  .filter((tag) => !excludedTags.includes(tag))
                  .slice(0, MAX_SUGGESTIONS)
              );
            }
          }
        } catch {
          if (latestQuery.current === key) {
            setUsers([]);
            setTags([]);
          }
        }
        if (latestQuery.current === key) {
          setLoading(false);
        }
      })();
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [excludedTags, excludedUserIds, query, trigger]);

  if (!trigger) {
    return null;
  }

  const items = trigger === "@" ? users : tags;
  let body: React.ReactNode;
  if (loading && items.length === 0) {
    body = (
      <View style={styles.loading}>
        <ActivityIndicator color={text.muted} size={14} />
        <Text style={[styles.muted, { color: text.muted }]}>Searching...</Text>
      </View>
    );
  } else if (items.length === 0) {
    body = (
      <Text style={[styles.empty, { color: text.muted }]}>
        {trigger === "#" ? "No matching tags" : "No matching users"}
      </Text>
    );
  } else if (trigger === "@") {
    body = users.map((user) => (
      <Pressable
        accessibilityLabel={`Mention @${user.username}`}
        accessibilityRole="button"
        key={user.id}
        onPress={() => onPickUser({ id: user.id, username: user.username })}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: "rgba(246, 107, 21, 0.1)" },
        ]}
      >
        <UserAvatar radius={8} size={24} url={user.avatarUrl} />
        <View style={styles.userCopy}>
          <Text
            numberOfLines={1}
            style={[styles.name, { color: text.foreground }]}
          >
            {user.displayName || user.username}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.handle, { color: text.muted }]}
          >
            @{user.username}
          </Text>
        </View>
      </Pressable>
    ));
  } else {
    body = tags.map((tag) => (
      <Pressable
        accessibilityLabel={`Tag #${tag}`}
        accessibilityRole="button"
        key={tag}
        onPress={() => onPickTag(tag)}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: "rgba(246, 107, 21, 0.1)" },
        ]}
      >
        <Text style={styles.hash}>#</Text>
        <Text style={[styles.name, { color: text.foreground }]}>{tag}</Text>
      </Pressable>
    ));
  }

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isDark ? "#242424" : "#ffffff",
          borderColor: isDark
            ? "rgba(255, 255, 255, 0.1)"
            : "rgba(0, 0, 0, 0.08)",
          boxShadow: isDark
            ? "0 0 0 1.5px rgba(255, 255, 255, 0.25), 0 0 0 3.5px rgba(255, 255, 255, 0.1), 0 8px 20px rgba(0, 0, 0, 0.25)"
            : "0 0 0 1.5px rgba(255, 255, 255, 0.25), 0 0 0 3.5px rgba(0, 0, 0, 0.08), 0 8px 20px rgba(0, 0, 0, 0.25)",
        },
      ]}
    >
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    maxHeight: 256,
    maxWidth: "100%",
    overflow: "hidden",
    width: 256,
  },
  empty: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    padding: 12,
  },
  handle: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
  },
  hash: {
    color: "#f66b15",
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  loading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    padding: 12,
  },
  muted: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
  },
  name: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  userCopy: {
    flex: 1,
    minWidth: 0,
  },
});
