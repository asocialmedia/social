// oxlint-disable react/todo -- Async requests retain visible failure and retry states.

import { mergeCommunityChatMemberOptions } from "@asm/messages";
import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { StatusActionButton } from "@/components/feedback/status-action-button";
import { DialogPanel } from "@/components/surface/dialog-panel";
import { premiumInput } from "@/components/surface/recipes";
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { useAppTheme } from "@/theme";

import {
  createCommunityChatPrivateThread,
  fetchCommunityChatMembers,
} from "../lib/community-chat-api";
import type { CommunityChatMemberOption } from "../lib/community-chat-api";

export function CommunityPrivateThreadDialog({
  slug,
  channelId,
  userId,
  options,
  onClose,
  onCreated,
}: {
  slug: string;
  channelId: string;
  userId: string;
  options: () => Promise<ApiCallOptions>;
  onClose: () => void;
  onCreated: (threadId: string) => void;
}) {
  const { theme, isDark } = useAppTheme();
  const input = premiumInput(isDark, false);
  const [name, setName] = useState("");
  const [starter, setStarter] = useState("");
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<CommunityChatMemberOption[]>([]);
  const [selected, setSelected] = useState<CommunityChatMemberOption[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const searchVersion = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (query.trim().length < 2) {
        return;
      }
      setSearching(true);
      try {
        const result = await fetchCommunityChatMembers(
          slug,
          query.trim(),
          null,
          await options()
        );
        if (!cancelled) {
          setMembers(result.members.filter((member) => member.id !== userId));
          setCursor(result.nextCursor);
          setSearchError(null);
        }
      } catch {
        if (!cancelled) {
          setSearchError(
            "Couldn’t find members. Change the search to try again."
          );
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [options, query, slug, userId]);

  const loadMore = async () => {
    if (!cursor || searching) {
      return;
    }
    const version = searchVersion.current;
    setSearching(true);
    setSearchError(null);
    try {
      const result = await fetchCommunityChatMembers(
        slug,
        query.trim(),
        cursor,
        await options()
      );
      if (version === searchVersion.current) {
        setMembers((current) =>
          mergeCommunityChatMemberOptions(
            current,
            result.members.filter((member) => member.id !== userId)
          )
        );
        setCursor(result.nextCursor);
      }
    } catch {
      if (version === searchVersion.current) {
        setSearchError("Couldn’t load more members. Try again.");
      }
    } finally {
      if (version === searchVersion.current) {
        setSearching(false);
      }
    }
  };

  const create = async () => {
    if (busy || !name.trim() || !starter.trim()) {
      return;
    }
    requestId.current ??= randomUUID();
    setBusy(true);
    setFormError(null);
    try {
      const { thread } = await createCommunityChatPrivateThread(
        slug,
        channelId,
        {
          clientId: requestId.current,
          inviteeUserIds: selected.map((member) => member.id),
          name: name.trim(),
          starterContent: starter.trim(),
        },
        await options()
      );
      onCreated(thread.id);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Couldn’t create this thread. Try again."
      );
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: input.background,
      boxShadow: input.shadows,
      color: input.text,
    },
  ];
  return (
    <DialogPanel
      title="Start a private thread"
      description="Only invited active members and community owners or moderators can read this conversation. Staff can inspect and moderate every private thread. Privacy cannot be changed later."
      busy={busy}
      onClose={onClose}
    >
      <Text style={[styles.label, { color: theme.inputText }]}>
        Thread name
      </Text>
      <TextInput
        accessibilityLabel="Private thread name"
        autoFocus
        editable={!busy}
        maxLength={64}
        value={name}
        onChangeText={setName}
        style={inputStyle}
        placeholder="What’s this conversation about?"
        placeholderTextColor={input.placeholder}
      />
      <Text style={[styles.label, { color: theme.inputText }]}>
        First message
      </Text>
      <TextInput
        accessibilityLabel="Private thread starter message"
        editable={!busy}
        maxLength={4000}
        multiline
        value={starter}
        onChangeText={setStarter}
        style={[inputStyle, styles.starter]}
        placeholder="This message stays inside the private thread"
        placeholderTextColor={input.placeholder}
      />
      <Text style={[styles.label, { color: theme.inputText }]}>
        Invite members · {selected.length}/50
      </Text>
      <TextInput
        accessibilityLabel="Find community members to invite"
        editable={!busy}
        maxLength={64}
        autoCapitalize="none"
        autoCorrect={false}
        value={query}
        onChangeText={(value) => {
          searchVersion.current += 1;
          setQuery(value);
          setMembers([]);
          setCursor(null);
          setSearching(value.trim().length >= 2);
          setSearchError(null);
        }}
        style={inputStyle}
        placeholder="Search a name or username"
        placeholderTextColor={input.placeholder}
      />
      <View style={styles.members}>
        {selected.map((member) => (
          <Pressable
            key={member.id}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${member.displayName} invitation`}
            disabled={busy}
            style={[styles.member, { backgroundColor: theme.cardBg }]}
            onPress={() =>
              setSelected((current) =>
                current.filter((entry) => entry.id !== member.id)
              )
            }
          >
            <Text style={{ color: theme.inputText }}>@{member.username} ×</Text>
          </Pressable>
        ))}
      </View>
      {members
        .filter((member) => !selected.some((entry) => entry.id === member.id))
        .map((member) => (
          <Pressable
            key={member.id}
            accessibilityRole="button"
            accessibilityLabel={`Invite ${member.displayName}, @${member.username}`}
            disabled={busy || selected.length >= 50}
            style={styles.result}
            onPress={() =>
              setSelected((current) =>
                current.length >= 50 ||
                current.some((entry) => entry.id === member.id)
                  ? current
                  : [...current, member]
              )
            }
          >
            <Text style={{ color: theme.inputText }}>{member.displayName}</Text>
            <Text style={{ color: theme.dividerText }}>@{member.username}</Text>
          </Pressable>
        ))}
      {searching ? (
        <ActivityIndicator accessibilityLabel="Searching members" />
      ) : null}
      {query.trim().length >= 2 &&
      !searching &&
      !searchError &&
      !members.length ? (
        <Text style={{ color: theme.dividerText }}>
          No matching active members.
        </Text>
      ) : null}
      {searchError ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: theme.errorBannerText }}
        >
          {searchError}
        </Text>
      ) : null}
      {cursor ? (
        <StatusActionButton
          disabled={busy || searching}
          label="Show more members"
          onPress={() => {
            void loadMore();
          }}
        />
      ) : null}
      {formError ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: theme.errorBannerText }}
        >
          {formError}
        </Text>
      ) : null}
      <StatusActionButton
        disabled={busy || !name.trim() || !starter.trim()}
        label={busy ? "Starting…" : "Create private thread"}
        onPress={() => {
          void create();
        }}
      />
    </DialogPanel>
  );
}

const styles = StyleSheet.create({
  input: {
    borderRadius: 12,
    fontFamily: "SofiaProReg",
    fontSize: 16,
    marginBottom: 16,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  label: { fontFamily: "SofiaProBold", fontSize: 14, marginBottom: 8 },
  member: {
    borderRadius: 24,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 12,
  },
  members: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  result: { justifyContent: "center", minHeight: 48, paddingVertical: 8 },
  starter: { minHeight: 100, paddingVertical: 12, textAlignVertical: "top" },
});
