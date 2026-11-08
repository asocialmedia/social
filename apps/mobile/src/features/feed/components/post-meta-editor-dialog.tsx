import { AtSign, Hash, Plus, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { toast } from "@/components/feedback/toast";
import { DialogPanel } from "@/components/surface/dialog-panel";
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  ORANGE_GRADIENT,
  ORANGE_BUTTON_SHADOWS,
  PURPLE_GRADIENT,
  VOTE_DOWN_SHADOWS_DARK,
} from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { useSessionContext } from "@/features/auth/state/session";
import { InlineSuggestions } from "@/features/composer/components/inline-suggestions";
import type { MentionPick } from "@/features/composer/lib/inline-relations";
import { HttpError } from "@/features/media-upload/lib/retry";
import {
  SettingsButton,
  SettingsInput,
  SettingsSubcard,
} from "@/features/settings/components/settings-ui";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import {
  filterSelfMentionIds,
  MAX_POST_MENTIONS,
  MAX_POST_TAGS,
} from "../lib/post-meta-limits";
import { updatePostMentions, updatePostTags } from "../lib/post-mutations";
import { feedCache } from "../state/feed-store";

interface Props {
  initialMentions?: readonly MentionPick[];
  initialTags: readonly string[];
  onClose: () => void;
  onSaved: (postId: string, tags: string[]) => void;
  open: boolean;
  postId: string;
}

export function EditPostTagsDialog(props: Props) {
  return props.open ? <MetadataEditor key={props.postId} {...props} /> : null;
}

// Web's tag/mention picker caps (gust-meta-pickers.tsx): at most 5 each.
// Limits live in lib/post-meta-limits so they can be unit tested.
const MAX_TAGS = MAX_POST_TAGS;
const MAX_MENTIONS = MAX_POST_MENTIONS;

const EMPTY_MENTIONS: readonly MentionPick[] = [];

function MetadataEditor({
  initialMentions = EMPTY_MENTIONS,
  initialTags,
  onClose,
  onSaved,
  postId,
}: Props) {
  const { theme } = useAppTheme();
  const { runWithInstallToken } = useInstall();
  const { user: currentUser } = useSessionContext();
  const [tab, setTab] = useState<"tags" | "mentions">("tags");
  const [tags, setTags] = useState<string[]>([...initialTags]);
  const [mentions, setMentions] = useState<MentionPick[]>([...initialMentions]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const currentUserId = currentUser?.id;
  const excludedUserIds = useMemo(() => {
    const ids = mentions.map((user) => user.id);
    // Web's mention picker never offers the current user: self-mentions are
    // dropped server-side (aura-farming guard), so selecting yourself would
    // silently lose the mention at publish.
    if (currentUserId && !ids.includes(currentUserId)) {
      ids.push(currentUserId);
    }
    return ids;
  }, [currentUserId, mentions]);
  const addTag = (value: string) => {
    const name = value.trim().replace(/^#+/, "");
    if (!name) {
      setQuery("");
      return;
    }
    // Web's GustTagPicker cap: at most 5 tags, announced with a toast.
    if (tags.length >= MAX_TAGS) {
      toast({
        description: "You can add up to 5 tags per post",
        title: "Up to 5 Tags",
        variant: "destructive",
      });
      return;
    }
    if (!tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) {
      setTags((current) => [...current, name]);
    }
    setQuery("");
  };
  const addMention = (user: MentionPick) => {
    // Self-mentions are dropped server-side, so ignore them like web.
    if (currentUserId && user.id === currentUserId) {
      return;
    }
    // Web's GustMentionPicker cap: at most 5 mentions, announced with a toast.
    if (mentions.length >= MAX_MENTIONS) {
      toast({
        description: "You can mention up to 5 people per post",
        title: "Up to 5 Mentions",
        variant: "destructive",
      });
      return;
    }
    if (!mentions.some((entry) => entry.id === user.id)) {
      setMentions((current) => [...current, user]);
    }
    setQuery("");
  };
  const save = async () => {
    setBusy(true);
    const result = await runWithInstallToken(
      async () => {
        try {
          const options = {
            apiBase: getApiBaseUrl(),
            cookie: await authClient.getCookie(),
          };
          await (tab === "tags"
            ? updatePostTags(postId, tags, options)
            : updatePostMentions(
                postId,
                // Web's useUpdateMentionsMutation strips the current user from
                // mention updates: self-mentions are dropped server-side.
                filterSelfMentionIds(
                  mentions.map((user) => user.id),
                  currentUserId
                ),
                options
              ));
          return { ok: true } as const;
        } catch (error) {
          return { error, ok: false } as const;
        }
      },
      (value) =>
        !value.ok &&
        value.error instanceof HttpError &&
        value.error.message === "install-token-required"
    );
    setBusy(false);
    if (!result) {
      return;
    }
    if (!result.ok) {
      toast({
        description:
          result.error instanceof Error
            ? result.error.message
            : "Please try again.",
        title: "Couldn't save changes",
        variant: "destructive",
      });
      return;
    }
    if (tab === "mentions") {
      const savedMentions = mentions.filter(
        (user) => user.id !== currentUserId
      );
      feedCache.updatePostEverywhere(postId, {
        mentions: savedMentions.map((user) => ({
          user: { ...user, avatarUrl: user.avatarUrl ?? null },
        })),
      });
    }
    onSaved(postId, tags);
    onClose();
  };
  return (
    <DialogPanel
      busy={busy}
      title="Edit Tags & Mentions"
      description="Manage tags and mentioned people for your post"
      onClose={onClose}
    >
      <View accessibilityRole="tablist" style={styles.tabs}>
        {(["tags", "mentions"] as const).map((value) => {
          const Icon = value === "tags" ? Hash : AtSign;
          const selected = tab === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              disabled={busy}
              onPress={() => {
                setTab(value);
                setQuery("");
              }}
              style={styles.tab}
            >
              {selected ? (
                <Gradient3D
                  colors={value === "tags" ? ORANGE_GRADIENT : PURPLE_GRADIENT}
                  shadows={
                    value === "tags"
                      ? ORANGE_BUTTON_SHADOWS
                      : VOTE_DOWN_SHADOWS_DARK
                  }
                  radius={8}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              <Icon
                color={selected ? "#ffffff" : theme.dividerText}
                size={16}
              />
              <Text
                style={{
                  color: selected ? "#ffffff" : theme.dividerText,
                  fontFamily: "SofiaProMed",
                }}
              >
                {value === "tags" ? "Tags" : "Mentions"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.chips}>
        {tab === "tags"
          ? tags.map((tag) => (
              <SettingsSubcard key={tag} style={styles.chip}>
                <Hash color="#f97316" size={13} />
                <Text style={{ color: theme.inputText }}>{tag}</Text>
                <Pressable
                  accessibilityLabel={`Remove tag ${tag}`}
                  disabled={busy}
                  hitSlop={6}
                  onPress={() =>
                    setTags((current) =>
                      current.filter((value) => value !== tag)
                    )
                  }
                >
                  <X color={theme.dividerText} size={14} />
                </Pressable>
              </SettingsSubcard>
            ))
          : mentions.map((user) => (
              <SettingsSubcard key={user.id} style={styles.chip}>
                <UserAvatar size={20} url={user.avatarUrl} />
                <Text style={{ color: theme.inputText }}>@{user.username}</Text>
                <Pressable
                  accessibilityLabel={`Remove mention ${user.username}`}
                  disabled={busy}
                  hitSlop={6}
                  onPress={() =>
                    setMentions((current) =>
                      current.filter((value) => value.id !== user.id)
                    )
                  }
                >
                  <X color={theme.dividerText} size={14} />
                </Pressable>
              </SettingsSubcard>
            ))}
      </View>
      <SettingsInput
        label={tab === "tags" ? "Search tags or create new" : "Search people"}
        value={query}
        onChangeText={setQuery}
        placeholder={
          tab === "tags" ? "Search tags or create new…" : "Search by username…"
        }
        editable={!busy}
      />
      {tab === "tags" && query.trim() ? (
        <Pressable
          accessibilityLabel={`Create tag ${query.trim()}`}
          disabled={busy}
          onPress={() => addTag(query)}
          style={styles.create}
        >
          <Plus color="#f97316" size={16} />
          <Text style={{ color: theme.inputText }}>
            Create tag “{query.trim()}”
          </Text>
        </Pressable>
      ) : null}
      <InlineSuggestions
        active={
          busy ? null : { query, start: 0, trigger: tab === "tags" ? "#" : "@" }
        }
        excludedTags={tags}
        excludedUserIds={excludedUserIds}
        onPickTag={addTag}
        onPickUser={addMention}
      />
      <View style={styles.footer}>
        <SettingsButton
          tone="gray"
          label="Cancel"
          disabled={busy}
          onPress={onClose}
        />
        <SettingsButton
          label="Save changes"
          loading={busy}
          onPress={() => {
            void save();
          }}
        />
      </View>
    </DialogPanel>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  create: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingVertical: 12,
  },
  footer: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 18,
  },
  tab: {
    alignItems: "center",
    borderRadius: 12,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    paddingVertical: 10,
  },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 16 },
});
