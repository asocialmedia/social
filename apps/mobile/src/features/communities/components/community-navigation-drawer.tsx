// oxlint-disable react/todo -- Requests retain visible loading and retry states in the drawer.

import type {
  CommunityChatRoom,
  CommunityChatThreadSummary,
} from "@asm/messages";
import { useRouter } from "expo-router";
import { FileText, LockKeyhole, MessageCircle, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusActionButton } from "@/components/feedback/status-action-button";
import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { resolveCommunityAccentColor } from "../lib/community-accents";
import { fetchCommunityChatChannels } from "../lib/community-chat-api";
import { communityChatUiEnabled } from "../lib/community-chat-features";

const EMPTY_THREADS: CommunityChatThreadSummary[] = [];

export function CommunityNavigationDrawer({
  active,
  accentColor,
  channels: availableChannels,
  channelId,
  communityName,
  onClose,
  slug,
  threadId,
  threads = EMPTY_THREADS,
}: {
  active: "posts" | "chat";
  accentColor: string | null;
  channels?: CommunityChatRoom[];
  channelId?: string;
  communityName: string;
  onClose: () => void;
  slug: string;
  threadId?: string | null;
  threads?: CommunityChatThreadSummary[];
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useAppTheme();
  const accent = resolveCommunityAccentColor(accentColor, isDark);
  const [channels, setChannels] = useState(availableChannels ?? []);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    availableChannels || !communityChatUiEnabled ? "ready" : "loading"
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (availableChannels || !communityChatUiEnabled) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const result = await fetchCommunityChatChannels(slug, {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        });
        if (!cancelled) {
          setChannels(result.channels);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Retry reloads this external request without changing the community.
  }, [availableChannels, slug, attempt]);

  const navigate = (path: `/a/${string}`) => {
    onClose();
    if (active === "chat") {
      router.replace(path);
    } else {
      router.push(path);
    }
  };
  const rowStyle = (selected: boolean) => [
    styles.row,
    selected && { backgroundColor: `${accent}18` },
  ];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable
          accessibilityLabel="Close community sidebar"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.panel,
            {
              backgroundColor: theme.containerBg,
              borderColor: theme.cardBorder,
              paddingBottom: insets.bottom + 12,
              paddingLeft: insets.left + 16,
              paddingTop: insets.top + 12,
            },
          ]}
        >
          <View style={styles.heading}>
            <Text
              accessibilityRole="header"
              numberOfLines={2}
              style={[styles.title, { color: theme.inputText }]}
            >
              {communityName}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close community sidebar"
              onPress={onClose}
              style={styles.close}
            >
              <X color={theme.dividerText} size={22} />
            </Pressable>
          </View>
          <View
            style={[styles.sections, { borderBottomColor: theme.cardBorder }]}
          >
            <Pressable
              accessibilityRole="link"
              accessibilityState={{ selected: active === "posts" }}
              style={[...rowStyle(active === "posts"), styles.tab]}
              onPress={() => {
                if (active === "posts") {
                  onClose();
                } else {
                  navigate(`/a/${slug}`);
                }
              }}
            >
              <FileText size={18} color={theme.inputText} />
              <Text style={[styles.label, { color: theme.inputText }]}>
                Posts
              </Text>
            </Pressable>
            {communityChatUiEnabled ? (
              <Pressable
                accessibilityRole="link"
                accessibilityState={{ selected: active === "chat" }}
                style={[...rowStyle(active === "chat"), styles.tab]}
                onPress={() =>
                  navigate(
                    channelId
                      ? `/a/${slug}/chat/${channelId}`
                      : `/a/${slug}/chat`
                  )
                }
              >
                <MessageCircle size={18} color={theme.inputText} />
                <Text style={[styles.label, { color: theme.inputText }]}>
                  Chat
                </Text>
              </Pressable>
            ) : null}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
            {communityChatUiEnabled ? (
              <Text
                accessibilityRole="header"
                style={[styles.eyebrow, { color: theme.dividerText }]}
              >
                Channels
              </Text>
            ) : null}
            {status === "loading" ? (
              <ActivityIndicator accessibilityLabel="Loading channels" />
            ) : null}
            {status === "error" ? (
              <View style={styles.error}>
                <Text style={{ color: theme.dividerText }}>
                  Couldn’t load channels.
                </Text>
                <StatusActionButton
                  label="Try again"
                  onPress={() => {
                    setStatus("loading");
                    setAttempt((value) => value + 1);
                  }}
                />
              </View>
            ) : null}
            {(availableChannels ?? channels).map((channel) => (
              <Pressable
                key={channel.id}
                accessibilityRole="link"
                accessibilityState={{ selected: channel.id === channelId }}
                style={rowStyle(channel.id === channelId)}
                onPress={() => navigate(`/a/${slug}/chat/${channel.id}`)}
              >
                <MessageCircle
                  size={17}
                  color={channel.id === channelId ? accent : theme.dividerText}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.channelName, { color: theme.inputText }]}
                >
                  {channel.name}
                </Text>
                {channel.channelType === "ANNOUNCEMENT" ? (
                  <Text style={[styles.staff, { color: theme.dividerText }]}>
                    Staff
                  </Text>
                ) : null}
              </Pressable>
            ))}
            {threads.length ? (
              <View
                style={[styles.threads, { borderTopColor: theme.cardBorder }]}
              >
                <Text style={[styles.eyebrow, { color: theme.dividerText }]}>
                  Threads in this channel
                </Text>
                {threads.map((thread) => (
                  <Pressable
                    key={thread.room.id}
                    accessibilityRole="link"
                    accessibilityState={{
                      selected: thread.room.id === threadId,
                    }}
                    style={rowStyle(thread.room.id === threadId)}
                    onPress={() =>
                      navigate(
                        `/a/${slug}/chat/${channelId}/threads/${thread.room.id}`
                      )
                    }
                  >
                    {thread.room.visibility === "PRIVATE" ? (
                      <LockKeyhole color={accent} size={16} />
                    ) : (
                      <MessageCircle color={accent} size={16} />
                    )}
                    <Text
                      numberOfLines={1}
                      style={[styles.channelName, { color: theme.inputText }]}
                    >
                      {thread.room.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  channelName: { flex: 1, fontFamily: "SofiaProReg", fontSize: 14 },
  close: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    minWidth: 48,
  },
  error: { gap: 12, padding: 12 },
  eyebrow: {
    fontFamily: "SofiaProBold",
    fontSize: 11,
    letterSpacing: 1,
    paddingHorizontal: 12,
    paddingVertical: 16,
    textTransform: "uppercase",
  },
  heading: { alignItems: "center", flexDirection: "row", minHeight: 56 },
  label: { fontFamily: "SofiaProBold", fontSize: 14 },
  panel: {
    borderBottomRightRadius: 26,
    borderColor: "transparent",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopRightRadius: 26,
    bottom: 0,
    left: 0,
    maxWidth: 384,
    paddingRight: 12,
    position: "absolute",
    top: 0,
    width: "86%",
  },
  row: {
    alignItems: "center",
    borderRadius: 14,
    flexDirection: "row",
    gap: 10,
    marginBottom: 4,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  scrim: { backgroundColor: "rgba(0,0,0,0.55)", flex: 1 },
  sections: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    paddingBottom: 8,
  },
  staff: {
    fontFamily: "SofiaProBold",
    fontSize: 9,
    textTransform: "uppercase",
  },
  tab: { flex: 1, justifyContent: "center" },
  threads: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12 },
  title: { flex: 1, fontFamily: "SofiaProBold", fontSize: 16 },
});
