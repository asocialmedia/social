// oxlint-disable no-nested-ternary, unicorn/no-nested-ternary, no-negated-condition, unicorn/no-negated-condition, no-void -- Compact mobile state branches keep the narrow composer readable; detached handlers surface errors in the screen.

import type { CommunityChatMessage, CommunityChatRoom } from "@asm/messages";
import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { fetch as streamingFetch } from "expo/fetch";
import { Hash, MessageCircle, Send, Users, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusActionButton } from "@/components/feedback/status-action-button";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { resolveCommunityAccentColor } from "@/features/communities/lib/community-accents";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { useUnreadNotificationCount } from "@/features/notifications/state/use-unread-count";
import { getApiBaseUrl } from "@/lib/api-env";
import { readSseStream } from "@/lib/sse-stream";
import { useAppTheme } from "@/theme";

import { fetchCommunityDetail } from "../lib/communities-api";
import type { CommunityDetail } from "../lib/communities-api";
import {
  CommunityChatApiError,
  fetchCommunityChatChannels,
  fetchCommunityChatMessage,
  fetchCommunityChatMessages,
  sendCommunityChatMessage,
} from "../lib/community-chat-api";
import type { CommunityChatChannelsResponse } from "../lib/community-chat-api";
import { CommunityAvatar } from "./community-avatar";

// oxlint-disable react/todo -- The current React Compiler lint cannot lower the async try/catch/finally blocks used for visible request and retry states.
// oxlint-disable react/set-state-in-effect -- Route activation starts a fetch and resets the loading/error state for that screen.

const HISTORY_LIMIT = 50;
const TRANSCRIPT_LIMIT = 800;
const CHAT_RECONCILE_MS = 30_000;

function userLabel(message: CommunityChatMessage): string {
  return message.sender.displayName.trim() || message.sender.username;
}

function chatUrl(slug: string, channelId: string): string {
  return `/a/${encodeURIComponent(slug)}/chat/${encodeURIComponent(channelId)}`;
}

function communityChatUrl(slug: string, roomId: string, suffix = ""): string {
  return `/api/communities/${encodeURIComponent(slug)}/chat/rooms/${encodeURIComponent(roomId)}${suffix}`;
}

export function CommunityChatChannelsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug =
    (Array.isArray(params.slug) ? params.slug[0] : params.slug) ?? "";
  const apiBase = getApiBaseUrl();
  const { isDark, theme } = useAppTheme();
  const { user } = useSessionContext();
  const unreadNotifications = useUnreadNotificationCount(
    user?.id ?? null,
    Boolean(user)
  );
  const [detail, setDetail] = useState<CommunityDetail | null>(null);
  const [channels, setChannels] = useState<CommunityChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const communityAccent = resolveCommunityAccentColor(
    detail?.community.accentColor,
    isDark
  );

  const load = useCallback(async () => {
    if (!slug) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const cookie = await authClient.getCookie();
      const requestOptions = cookie ? { apiBase, cookie } : { apiBase };
      const [nextDetail, chat] = await Promise.all([
        fetchCommunityDetail(slug, requestOptions),
        fetchCommunityChatChannels(slug, requestOptions),
      ]);
      setDetail(nextDetail);
      setChannels(chat.channels);
    } catch (error) {
      setLoadError(
        error instanceof CommunityChatApiError
          ? error.message
          : "Couldn't open community chat"
      );
    } finally {
      setLoading(false);
    }
  }, [apiBase, slug]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Load community chat as soon as its route becomes active.
    void load();
  }, [load]);

  const headerUser = user
    ? {
        avatarUrl: user.image ?? null,
        id: user.id,
        username: user.username ?? "",
      }
    : null;

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader user={headerUser} unreadCount={unreadNotifications} />
      {detail ? (
        <View
          style={[
            styles.communityHeader,
            { borderBottomColor: theme.cardBorder },
          ]}
        >
          <CommunityAvatar community={detail.community} size={44} />
          <View style={styles.flex}>
            <Text style={[styles.eyebrow, { color: theme.dividerText }]}>
              Community conversation
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.communityName, { color: theme.inputText }]}
            >
              {detail.community.name}
            </Text>
          </View>
          <View
            style={[
              styles.memberPill,
              { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
            ]}
          >
            <Users color={theme.dividerText} size={14} />
            <Text style={[styles.memberCount, { color: theme.dividerText }]}>
              {detail.stats.members.toLocaleString()}
            </Text>
          </View>
        </View>
      ) : null}
      <View
        style={[styles.sectionTabs, { borderBottomColor: theme.cardBorder }]}
      >
        <Pressable
          onPress={() => router.replace(`/a/${slug}`)}
          style={styles.sectionTab}
        >
          <Text style={[styles.sectionTabText, { color: theme.dividerText }]}>
            Posts
          </Text>
        </Pressable>
        <View
          style={[
            styles.sectionTab,
            styles.activeSectionTab,
            { borderBottomColor: communityAccent },
          ]}
        >
          <Text
            style={[
              styles.sectionTabText,
              { color: theme.inputText, fontFamily: "SofiaProBold" },
            ]}
          >
            Chat
          </Text>
        </View>
      </View>
      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={communityAccent} />
        </View>
      ) : loadError === null ? (
        channels.length === 0 ? (
          <View style={styles.state}>
            <MessageCircle color={communityAccent} size={30} />
            <Text style={[styles.stateTitle, { color: theme.inputText }]}>
              No chat rooms yet
            </Text>
            <Text style={[styles.stateBody, { color: theme.dividerText }]}>
              The community team can add a room for everyone to gather.
            </Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={styles.channelList}
            data={channels}
            keyExtractor={(channel) => channel.id}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(chatUrl(slug, item.id))}
                style={({ pressed }) => [
                  styles.channelCard,
                  {
                    backgroundColor: theme.cardBg,
                    borderColor: theme.cardBorder,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.channelIcon,
                    { backgroundColor: `${communityAccent}18` },
                  ]}
                >
                  <Hash color={communityAccent} size={18} />
                </View>
                <View style={styles.flex}>
                  <View style={styles.row}>
                    <Text
                      style={[styles.channelName, { color: theme.inputText }]}
                    >
                      {item.name}
                    </Text>
                    {item.channelType === "ANNOUNCEMENT" ? (
                      <Text
                        style={[
                          styles.staffLabel,
                          { color: theme.dividerText },
                        ]}
                      >
                        STAFF UPDATES
                      </Text>
                    ) : null}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[styles.channelTopic, { color: theme.dividerText }]}
                  >
                    {item.topic || "A conversation in this community"}
                  </Text>
                </View>
                <Text style={[styles.chevron, { color: theme.dividerText }]}>
                  ›
                </Text>
              </Pressable>
            )}
          />
        )
      ) : (
        <View style={styles.state}>
          <Text style={[styles.stateTitle, { color: theme.inputText }]}>
            {loadError}
          </Text>
          <StatusActionButton label="Try again" onPress={load} />
        </View>
      )}
      <MobileBottomNav />
    </View>
  );
}

export function CommunityChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    "channel-id"?: string | string[];
    slug?: string | string[];
  }>();
  const slug =
    (Array.isArray(params.slug) ? params.slug[0] : params.slug) ?? "";
  const routeChannelId = params["channel-id"];
  const channelId =
    (Array.isArray(routeChannelId) ? routeChannelId[0] : routeChannelId) ?? "";
  const apiBase = getApiBaseUrl();
  const insets = useSafeAreaInsets();
  const { isDark, theme } = useAppTheme();
  const { user } = useSessionContext();
  const unreadNotifications = useUnreadNotificationCount(
    user?.id ?? null,
    Boolean(user)
  );
  const [detail, setDetail] = useState<CommunityDetail | null>(null);
  const [channels, setChannels] = useState<CommunityChatRoom[]>([]);
  const [room, setRoom] = useState<CommunityChatRoom | null>(null);
  const [messages, setMessages] = useState<CommunityChatMessage[]>([]);
  const [permissions, setPermissions] = useState<
    CommunityChatChannelsResponse["permissions"] | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<{
    clientId: string;
    content: string;
  } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const communityAccent = resolveCommunityAccentColor(
    detail?.community.accentColor,
    isDark
  );
  const listRef = useRef<FlatList<CommunityChatMessage>>(null);
  const latestSequence = useRef("0");
  const latestChangeSequence = useRef("0");
  const paging = useRef(false);

  const options = useCallback(
    async () => ({
      apiBase,
      cookie: (await authClient.getCookie()) ?? undefined,
    }),
    [apiBase]
  );

  const mergeMessages = useCallback((incoming: CommunityChatMessage[]) => {
    if (incoming.length === 0) {
      return;
    }
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]));
      for (const message of incoming) {
        byId.set(message.id, message);
      }
      const ordered = [...byId.values()].toSorted((left, right) => {
        const a = BigInt(left.sequence);
        const b = BigInt(right.sequence);
        if (a > b) {
          return -1;
        }
        if (a < b) {
          return 1;
        }
        return 0;
      });
      latestSequence.current = ordered[0]?.sequence ?? latestSequence.current;
      for (const message of ordered) {
        if (
          BigInt(message.changeSequence) > BigInt(latestChangeSequence.current)
        ) {
          latestChangeSequence.current = message.changeSequence;
        }
      }
      return ordered.slice(0, TRANSCRIPT_LIMIT);
    });
  }, []);

  const fetchLatest = useCallback(async () => {
    const requestOptions = await options();
    const page = await fetchCommunityChatMessages(
      slug,
      channelId,
      {
        after:
          latestSequence.current === "0" ? undefined : latestSequence.current,
        limit: HISTORY_LIMIT,
      },
      requestOptions
    );
    setPermissions(page.permissions);
    setRoom(page.room);
    mergeMessages(page.messages);
  }, [channelId, mergeMessages, options, slug]);

  const loadPage = useCallback(async () => {
    if (!slug || !channelId) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    latestSequence.current = "0";
    latestChangeSequence.current = "0";
    try {
      const requestOptions = await options();
      const [communityDetail, chatChannels, page] = await Promise.all([
        fetchCommunityDetail(slug, requestOptions),
        fetchCommunityChatChannels(slug, requestOptions),
        fetchCommunityChatMessages(
          slug,
          channelId,
          { limit: HISTORY_LIMIT },
          requestOptions
        ),
      ]);
      const selectedChannel = chatChannels.channels.find(
        (channel) => channel.id === channelId
      );
      if (!selectedChannel) {
        throw new Error("This room is not available");
      }
      setDetail(communityDetail);
      setChannels(chatChannels.channels);
      setPermissions(page.permissions);
      setRoom(page.room);
      setMessages([...page.messages].toReversed());
      setHasOlder(page.nextBeforeSequence !== null);
      latestSequence.current = page.messages.at(-1)?.sequence ?? "0";
      latestChangeSequence.current =
        page.messages.at(-1)?.changeSequence ?? "0";
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Couldn't open this room"
      );
    } finally {
      setLoading(false);
    }
  }, [channelId, options, slug]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Load the selected room when its route becomes active.
    void loadPage();
  }, [loadPage]);

  const loadOlder = useCallback(async () => {
    const oldest = messages.at(-1);
    if (!oldest || !hasOlder || paging.current) {
      return;
    }
    paging.current = true;
    setLoadingOlder(true);
    try {
      const page = await fetchCommunityChatMessages(
        slug,
        channelId,
        { before: oldest.sequence, limit: HISTORY_LIMIT },
        await options()
      );
      setHasOlder(page.nextBeforeSequence !== null);
      mergeMessages(page.messages);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Couldn't load earlier messages"
      );
    } finally {
      paging.current = false;
      setLoadingOlder(false);
    }
  }, [channelId, hasOlder, mergeMessages, messages, options, slug]);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      const connect = async () => {
        const currentCookie = await authClient.getCookie();
        await readSseStream({
          baseFetch: streamingFetch,
          eventName: ["change", "reset", "access-revoked"],
          getCookie: () => Promise.resolve(currentCookie),
          onEvent: async (event, data) => {
            if (event === "access-revoked") {
              setMessages([]);
              setLoadError("Your access to this room changed.");
              return;
            }
            if (event === "change") {
              const change = data as { kind?: string; messageId?: string };
              if (
                (change.kind === "message.edited" ||
                  change.kind === "message.deleted") &&
                typeof change.messageId === "string"
              ) {
                const { messageId } = change;
                try {
                  const requestOptions = await options();
                  const result = await fetchCommunityChatMessage(
                    slug,
                    channelId,
                    messageId,
                    requestOptions
                  );
                  mergeMessages([result.message]);
                } catch {
                  setSendError("Couldn't refresh this message.");
                }
                return;
              }
            }
            if (event === "reset" || event === "change") {
              try {
                await fetchLatest();
              } catch {
                setSendError(
                  "Live updates paused. Reconnect to refresh this room."
                );
              }
            }
          },
          onUnauthorized: () => {
            // oxlint-disable-next-line no-void -- Sign out before the stream reconnects with stale credentials.
            void authClient.signOut();
            return false;
          },
          signal: controller.signal,
          url: `${apiBase}${communityChatUrl(slug, channelId, `/events?after=${encodeURIComponent(latestChangeSequence.current)}`)}`,
        });
      };
      // oxlint-disable-next-line no-void -- Focus effect starts the cancellable event stream.
      void connect();
      const timer = setInterval(async () => {
        try {
          await fetchLatest();
        } catch {
          setSendError("Live updates paused. Reconnect to refresh this room.");
        }
      }, CHAT_RECONCILE_MS);
      return () => {
        clearInterval(timer);
        controller.abort();
      };
    }, [apiBase, channelId, fetchLatest, mergeMessages, options, slug])
  );

  useEffect(() => {
    if (!loading && messages.length > 0) {
      requestAnimationFrame(() =>
        listRef.current?.scrollToOffset({ animated: false, offset: 0 })
      );
    }
  }, [loading, messages.length]);

  const submit = useCallback(async () => {
    const outgoing = pending ?? {
      clientId: randomUUID(),
      content: content.trim(),
    };
    if (!outgoing.content || sending || !permissions?.canSend) {
      return;
    }
    setPending(outgoing);
    setSending(true);
    setSendError(null);
    try {
      const result = await sendCommunityChatMessage(
        slug,
        channelId,
        outgoing,
        await options()
      );
      mergeMessages([result.message]);
      setPending(null);
      setContent("");
      requestAnimationFrame(() =>
        listRef.current?.scrollToOffset({ animated: false, offset: 0 })
      );
    } catch (error) {
      setPending(outgoing);
      setContent(outgoing.content);
      setSendError(
        error instanceof Error ? error.message : "Message didn't send"
      );
    } finally {
      setSending(false);
    }
  }, [
    channelId,
    content,
    mergeMessages,
    options,
    pending,
    permissions?.canSend,
    sending,
    slug,
  ]);

  const headerUser = user
    ? {
        avatarUrl: user.image ?? null,
        id: user.id,
        username: user.username ?? "",
      }
    : null;
  const channelName = room?.name ?? "Community chat";

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top + 52}
      style={[styles.root, { backgroundColor: theme.containerBg }]}
    >
      <MobileHeader user={headerUser} unreadCount={unreadNotifications} />
      {detail ? (
        <View
          style={[
            styles.compactHeader,
            { borderBottomColor: theme.cardBorder },
          ]}
        >
          <Pressable
            accessibilityLabel="Browse community rooms"
            onPress={() => setChannelsOpen(true)}
            style={styles.roomIconButton}
          >
            <Hash color={communityAccent} size={17} />
          </Pressable>
          <View style={styles.flex}>
            <Text
              numberOfLines={1}
              style={[styles.channelName, { color: theme.inputText }]}
            >
              {channelName}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.channelTopic, { color: theme.dividerText }]}
            >
              {room?.topic || `A conversation in ${detail.community.name}`}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Open community chat rooms"
            onPress={() => setChannelsOpen(true)}
            style={styles.roomIconButton}
          >
            <Users color={theme.dividerText} size={18} />
          </Pressable>
        </View>
      ) : null}
      <View
        style={[styles.sectionTabs, { borderBottomColor: theme.cardBorder }]}
      >
        <Pressable
          onPress={() => router.replace(`/a/${slug}`)}
          style={styles.sectionTab}
        >
          <Text style={[styles.sectionTabText, { color: theme.dividerText }]}>
            Posts
          </Text>
        </Pressable>
        <View
          style={[
            styles.sectionTab,
            styles.activeSectionTab,
            { borderBottomColor: communityAccent },
          ]}
        >
          <Text
            style={[
              styles.sectionTabText,
              { color: theme.inputText, fontFamily: "SofiaProBold" },
            ]}
          >
            Chat
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={communityAccent} />
        </View>
      ) : loadError ? (
        <View style={styles.state}>
          <Text style={[styles.stateTitle, { color: theme.inputText }]}>
            {loadError}
          </Text>
          <StatusActionButton
            label="Try again"
            onPress={() => void loadPage()}
          />
        </View>
      ) : (
        <>
          <FlatList
            inverted
            contentContainerStyle={styles.messageList}
            data={messages}
            keyExtractor={(message) => message.id}
            ListEmptyComponent={
              <View style={styles.emptyMessages}>
                {detail ? (
                  <CommunityAvatar community={detail.community} size={54} />
                ) : null}
                <Text style={[styles.stateTitle, { color: theme.inputText }]}>
                  A fresh place to start
                </Text>
                <Text style={[styles.stateBody, { color: theme.dividerText }]}>
                  Say hello to the community.
                </Text>
              </View>
            }
            ListFooterComponent={
              loadingOlder ? (
                <ActivityIndicator color={communityAccent} />
              ) : null
            }
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            onEndReached={() => void loadOlder()}
            onEndReachedThreshold={0.3}
            ref={listRef}
            renderItem={({ item, index }) => {
              const newer = messages[index - 1];
              const grouped = Boolean(
                newer && newer.senderId === item.senderId
              );
              return (
                <View
                  style={[styles.messageRow, grouped && styles.groupedMessage]}
                >
                  <View style={styles.messageAvatarSlot}>
                    {!grouped ? (
                      <Image
                        source={
                          item.sender.avatarUrl
                            ? { uri: item.sender.avatarUrl }
                            : undefined
                        }
                        style={[
                          styles.avatar,
                          {
                            backgroundColor: theme.cardBg,
                            borderColor: theme.cardBorder,
                          },
                        ]}
                      />
                    ) : null}
                  </View>
                  <View style={styles.messageBody}>
                    {!grouped ? (
                      <View style={styles.messageMeta}>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.senderName,
                            { color: theme.inputText },
                          ]}
                        >
                          {userLabel(item)}
                        </Text>
                        <Text
                          style={[
                            styles.timestamp,
                            { color: theme.dividerText },
                          ]}
                        >
                          {new Date(item.createdAt).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </Text>
                        {item.editedAt ? (
                          <Text
                            style={[
                              styles.timestamp,
                              { color: theme.dividerText },
                            ]}
                          >
                            edited
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                    {item.payload?.type === "text" ? (
                      <Text
                        style={[styles.messageText, { color: theme.inputText }]}
                      >
                        {item.payload.content}
                      </Text>
                    ) : item.deletedAt ? (
                      <Text
                        style={[
                          styles.deletedText,
                          { color: theme.dividerText },
                        ]}
                      >
                        This message was removed by community staff.
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            }}
            showsVerticalScrollIndicator={false}
          />
          {!permissions?.canSend ? (
            <View
              style={[
                styles.readOnly,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: theme.cardBorder,
                },
              ]}
            >
              <Text style={[styles.readOnlyText, { color: theme.dividerText }]}>
                {!permissions?.isMember
                  ? "Join this community to add to the conversation."
                  : room?.channelType === "ANNOUNCEMENT"
                    ? "Only community staff can post updates here."
                    : "You can read this room, but can’t send messages right now."}
              </Text>
            </View>
          ) : (
            <View
              style={[
                styles.composer,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: theme.cardBorder,
                  marginBottom: Math.max(insets.bottom, 10),
                },
              ]}
            >
              <TextInput
                accessibilityLabel={`Message #${channelName}`}
                editable={!sending}
                maxLength={4000}
                multiline
                onChangeText={(value) => {
                  setContent(value);
                  if (pending) {
                    setPending(null);
                  }
                  if (sendError) {
                    setSendError(null);
                  }
                }}
                onSubmitEditing={() => void submit()}
                placeholder={`Write to #${channelName}`}
                placeholderTextColor={theme.dividerText}
                returnKeyType="send"
                style={[styles.composerInput, { color: theme.inputText }]}
                value={content}
              />
              <Pressable
                accessibilityLabel="Send message"
                accessibilityRole="button"
                disabled={!content.trim() || sending}
                onPress={() => void submit()}
                style={({ pressed }) => [
                  styles.sendButton,
                  {
                    backgroundColor: communityAccent,
                    opacity:
                      !content.trim() || sending ? 0.48 : pressed ? 0.78 : 1,
                  },
                ]}
              >
                {sending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Send color="#fff" size={17} />
                )}
              </Pressable>
              {sendError ? (
                <View style={styles.retryRow}>
                  <Text
                    style={[styles.retryText, { color: theme.errorBannerText }]}
                  >
                    {sendError}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={sending}
                    onPress={() => void submit()}
                  >
                    <Text
                      style={[styles.retryAction, { color: communityAccent }]}
                    >
                      Retry
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          )}
        </>
      )}
      <MobileBottomNav />
      <Modal
        animationType="slide"
        onRequestClose={() => setChannelsOpen(false)}
        transparent
        visible={channelsOpen}
      >
        <Pressable
          onPress={() => setChannelsOpen(false)}
          style={styles.modalScrim}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.channelSheet,
              {
                backgroundColor: theme.containerBg,
                borderColor: theme.cardBorder,
                paddingBottom: insets.bottom + 20,
              },
            ]}
          >
            <View style={styles.sheetHeading}>
              <View>
                <Text style={[styles.sheetTitle, { color: theme.inputText }]}>
                  Community rooms
                </Text>
                <Text
                  style={[styles.channelTopic, { color: theme.dividerText }]}
                >
                  Choose where to join in
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close rooms"
                onPress={() => setChannelsOpen(false)}
              >
                <X color={theme.dividerText} size={22} />
              </Pressable>
            </View>
            {channels.map((channel) => (
              <Pressable
                accessibilityRole="button"
                key={channel.id}
                onPress={() => {
                  setChannelsOpen(false);
                  router.replace(chatUrl(slug, channel.id));
                }}
                style={[
                  styles.sheetChannel,
                  channel.id === channelId && {
                    backgroundColor: `${communityAccent}18`,
                  },
                ]}
              >
                <Hash
                  color={
                    channel.id === channelId
                      ? communityAccent
                      : theme.dividerText
                  }
                  size={17}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.channelName, { color: theme.inputText }]}
                >
                  {channel.name}
                </Text>
                {channel.channelType === "ANNOUNCEMENT" ? (
                  <Text
                    style={[styles.staffLabel, { color: theme.dividerText }]}
                  >
                    STAFF
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  activeSectionTab: { borderBottomWidth: 2 },
  avatar: {
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    height: 34,
    width: 34,
  },
  channelCard: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
    minHeight: 72,
    paddingHorizontal: 13,
  },
  channelIcon: {
    alignItems: "center",
    borderRadius: 13,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  channelList: { paddingHorizontal: 16, paddingVertical: 16 },
  channelName: { fontFamily: "SofiaProBold", fontSize: 15 },
  channelSheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    left: 0,
    paddingHorizontal: 18,
    paddingTop: 20,
    position: "absolute",
    right: 0,
  },
  channelTopic: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 3 },
  chevron: {
    fontSize: 26,
    fontWeight: "300",
    lineHeight: 28,
    paddingHorizontal: 4,
  },
  communityHeader: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
  },
  communityName: { fontFamily: "SofiaProBold", fontSize: 16, marginTop: 2 },
  compactHeader: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 11,
    minHeight: 58,
    paddingHorizontal: 12,
  },
  composer: {
    alignItems: "flex-end",
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    padding: 9,
  },
  composerInput: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    maxHeight: 112,
    minHeight: 38,
    paddingHorizontal: 6,
    paddingTop: 8,
    textAlignVertical: "top",
  },
  deletedText: { fontFamily: "SofiaProReg", fontSize: 13, fontStyle: "italic" },
  emptyMessages: {
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
    paddingVertical: 30,
    transform: [{ scaleY: -1 }],
  },
  eyebrow: {
    fontFamily: "SofiaProMed",
    fontSize: 9,
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  flex: { flex: 1, minWidth: 0 },
  groupedMessage: { paddingTop: 2 },
  memberCount: { fontFamily: "SofiaProMed", fontSize: 11 },
  memberPill: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  messageAvatarSlot: { alignItems: "center", paddingTop: 2, width: 36 },
  messageBody: { flex: 1, gap: 3, minWidth: 0 },
  messageList: { flexGrow: 1, paddingHorizontal: 12, paddingVertical: 12 },
  messageMeta: {
    alignItems: "baseline",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  messageRow: {
    flexDirection: "row",
    gap: 9,
    paddingBottom: 7,
    paddingTop: 9,
    transform: [{ scaleY: -1 }],
  },
  messageText: { fontFamily: "SofiaProReg", fontSize: 14, lineHeight: 20 },
  modalScrim: {
    backgroundColor: "rgba(0,0,0,0.38)",
    flex: 1,
    justifyContent: "flex-end",
  },
  readOnly: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  readOnlyText: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    textAlign: "center",
  },
  retryAction: { fontFamily: "SofiaProBold", fontSize: 12 },
  retryRow: {
    alignItems: "center",
    flexBasis: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  retryText: { flex: 1, fontFamily: "SofiaProReg", fontSize: 11 },
  roomIconButton: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  root: { flex: 1 },
  row: { alignItems: "center", flexDirection: "row", gap: 8 },
  sectionTab: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 90,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  sectionTabText: { fontFamily: "SofiaProMed", fontSize: 14 },
  sectionTabs: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    paddingHorizontal: 8,
  },
  sendButton: {
    alignItems: "center",
    borderRadius: 15,
    height: 38,
    justifyContent: "center",
    width: 40,
  },
  senderName: { fontFamily: "SofiaProBold", fontSize: 13, maxWidth: "70%" },
  sheetChannel: {
    alignItems: "center",
    borderRadius: 13,
    flexDirection: "row",
    gap: 12,
    marginTop: 5,
    minHeight: 45,
    paddingHorizontal: 12,
  },
  sheetHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sheetTitle: { fontFamily: "SofiaProBold", fontSize: 17 },
  staffLabel: { fontFamily: "SofiaProBold", fontSize: 9, letterSpacing: 0.7 },
  state: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 28,
  },
  stateBody: { fontFamily: "SofiaProReg", fontSize: 13, textAlign: "center" },
  stateTitle: { fontFamily: "SofiaProBold", fontSize: 17, textAlign: "center" },
  timestamp: { fontFamily: "SofiaProReg", fontSize: 10 },
});
