import type {
  CommunityChatChange,
  CommunityChatMessage,
  CommunityChatRoom,
  CommunityChatThreadSummary,
} from "@asm/messages";
// oxlint-disable no-nested-ternary, unicorn/no-nested-ternary, no-negated-condition, unicorn/no-negated-condition, no-void, no-await-in-loop, unicorn/no-array-sort, unicorn/no-array-reverse, unicorn/prefer-spread -- Compact mobile state branches keep the narrow composer readable; detached handlers surface errors in the screen; SSE change actions apply sequentially in arrival order. sort/reverse run on fresh copies (spread/filter/slice first): the device Hermes predates ES2023 toSorted/toReversed (TypeError on device), so the mutating forms on copies are the compatible spelling.
import { mergeCommunityChatTimeline } from "@asm/messages";
import * as Clipboard from "expo-clipboard";
import { randomUUID } from "expo-crypto";
import type { Href } from "expo-router";
import {
  Redirect,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { fetch as streamingFetch } from "expo/fetch";
import {
  ArrowDown,
  ArrowLeft,
  PanelLeft,
  LockKeyhole,
  MessageCircle,
  ChevronDown,
  MoreHorizontal,
  Pin,
  Reply,
  Send,
  Users,
  X,
} from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  AppState,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { FlatListProps, TextInputInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusActionButton } from "@/components/feedback/status-action-button";
import { toast } from "@/components/feedback/toast";
import { ZephLoader } from "@/components/feedback/zeph-loader";
import { DialogPanel } from "@/components/surface/dialog-panel";
import { premiumInput } from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { resolveCommunityAccentColor } from "@/features/communities/lib/community-accents";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { useUnreadNotificationCount } from "@/features/notifications/state/use-unread-count";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/layout/list-virtualization";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { readSseStream } from "@/lib/network/sse-stream";
import { useAppTheme } from "@/theme";

import { fetchCommunityDetail } from "../lib/communities-api";
import type { CommunityDetail } from "../lib/communities-api";
import {
  CommunityChatApiError,
  advanceCommunityChatRead,
  fetchCommunityChatChannels,
  fetchCommunityChatMessage,
  fetchCommunityChatMessages,
  fetchCommunityChatThreads,
  fetchCommunityChatPins,
  mutateCommunityChatMessage,
  updateCommunityChatPin,
  createCommunityChatPublicThread,
  sendCommunityChatMessage,
  updateCommunityChatReaction,
} from "../lib/community-chat-api";
import type { CommunityChatChannelsResponse } from "../lib/community-chat-api";
import {
  classifyCommunityChatChange,
  isStaleCommunityChatChange,
} from "../lib/community-chat-events";
import { communityChatUiEnabled } from "../lib/community-chat-features";
import { stabilizeCommunityChatRows } from "../lib/community-chat-row-identity";
import { shouldSnapTimelineToLatest } from "../lib/community-chat-timeline-gate";
import { rememberCommunityChatHref } from "../lib/community-section-links";
import { CommunityAboutCard } from "./community-about-card";
import { CommunityAvatar } from "./community-avatar";
import { CommunityChannelSettingsButton } from "./community-channel-settings";
import CommunityChatLoading from "./community-chat-loading";
import CommunityChatMessageActions from "./community-chat-message-actions";
import CommunityChatMessageRow from "./community-chat-message-row";
import { CommunityNavigationDrawer } from "./community-navigation-drawer";
import { CommunityPrivateThreadDialog } from "./community-private-thread-dialog";
import { CommunityThreadFollowButton } from "./community-thread-follow-button";

// oxlint-disable react/todo -- The current React Compiler lint cannot lower the async try/catch/finally blocks used for visible request and retry states.
// oxlint-disable react/set-state-in-effect -- Route activation starts a fetch and resets the loading/error state for that screen.

const HISTORY_LIMIT = 50;
const CHAT_RECONCILE_MS = 30_000;
const CHAT_VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 50,
  minimumViewTime: 300,
};

function userLabel(message: CommunityChatMessage): string {
  return message.sender.displayName.trim() || message.sender.username;
}

// Typed object hrefs let expo-router encode each segment and keep the
// route table checked when the generated route types change.
function chatUrl(slug: string, channelId: string): Href {
  return {
    params: { "channel-id": channelId, slug },
    pathname: "/a/[slug]/chat/[channel-id]",
  };
}

function threadUrl(slug: string, channelId: string, threadId: string): Href {
  return {
    params: { "channel-id": channelId, slug, "thread-id": threadId },
    pathname: "/a/[slug]/chat/[channel-id]/threads/[thread-id]",
  };
}

function communityChatUrl(slug: string, roomId: string, suffix = ""): string {
  return `/api/communities/${encodeURIComponent(slug)}/chat/rooms/${encodeURIComponent(roomId)}${suffix}`;
}

export function CommunityChatChannelsScreen() {
  const { user } = useSessionContext();
  if (!communityChatUiEnabled) {
    return <Redirect href="/" />;
  }
  return <CommunityChatChannelsContent key={user?.id ?? "guest"} />;
}

function CommunityChatChannelsContent() {
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
          <ZephLoader variant="messages" color={communityAccent} />
        </View>
      ) : loadError === null ? (
        channels.length === 0 ? (
          <View style={styles.state}>
            <MessageCircle color={communityAccent} size={30} />
            <Text style={[styles.stateTitle, { color: theme.inputText }]}>
              No channels yet
            </Text>
            <Text style={[styles.stateBody, { color: theme.dividerText }]}>
              Community owners and moderators can create channels for everyone
              to join.
            </Text>
          </View>
        ) : (
          <FlatList
            {...LIST_VIRTUALIZATION_PROPS}
            contentContainerStyle={styles.channelList}
            data={channels}
            keyExtractor={(channel) => channel.id}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  rememberCommunityChatHref(
                    user?.id,
                    slug,
                    `/a/${slug}/chat/${item.id}`
                  );
                  router.push(chatUrl(slug, item.id));
                }}
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
                  <MessageCircle color={communityAccent} size={18} />
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
                        ANNOUNCEMENT
                      </Text>
                    ) : null}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[styles.channelTopic, { color: theme.dividerText }]}
                  >
                    {item.topic || "A channel in this community"}
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

// The timeline composer, memoized with local draft state so typing does not
// re-render the FlatList above it. The screen only learns the text on submit.
const CommunityChatComposer = memo(
  ({
    accent,
    channelName,
    inputRef,
    onClearReply,
    onSubmit,
    replyingToName,
    resetKey,
    sendError,
    sending,
  }: {
    accent: string;
    channelName: string;
    inputRef: RefObject<TextInputInstance | null>;
    onClearReply: () => void;
    onSubmit: (content: string) => void;
    replyingToName: string | null;
    resetKey: number;
    sendError: string | null;
    sending: boolean;
  }) => {
    const { theme } = useAppTheme();
    const insets = useSafeAreaInsets();
    const [content, setContent] = useState("");
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    useEffect(() => {
      const show = Keyboard.addListener(
        Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
        () => setKeyboardVisible(true)
      );
      const hide = Keyboard.addListener(
        Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
        () => setKeyboardVisible(false)
      );
      return () => {
        show.remove();
        hide.remove();
      };
    }, []);
    // Clears the draft when the parent bumps resetKey after a successful send.
    const [appliedResetKey, setAppliedResetKey] = useState(resetKey);
    useEffect(() => {
      if (appliedResetKey !== resetKey) {
        setAppliedResetKey(resetKey);
        setContent("");
      }
    }, [appliedResetKey, resetKey]);
    const trimmed = content.trim();
    return (
      <View
        style={[
          styles.composer,
          {
            backgroundColor: theme.cardBg,
            borderColor: theme.cardBorder,
            marginBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 10),
          },
        ]}
      >
        {replyingToName ? (
          <View style={[styles.retryRow, { width: "100%" }]}>
            <Reply color={accent} size={14} />
            <Text
              numberOfLines={1}
              style={[styles.retryText, { color: theme.dividerText }]}
            >
              Replying to {replyingToName}
            </Text>
            <Pressable accessibilityLabel="Cancel reply" onPress={onClearReply}>
              <X color={theme.dividerText} size={18} />
            </Pressable>
          </View>
        ) : null}
        <TextInput
          ref={inputRef}
          accessibilityLabel={`Message ${channelName}`}
          editable={!sending}
          maxLength={4000}
          multiline
          onChangeText={setContent}
          onSubmitEditing={() => onSubmit(trimmed)}
          placeholder={`Message ${channelName}`}
          placeholderTextColor={theme.dividerText}
          returnKeyType="send"
          style={[styles.composerInput, { color: theme.inputText }]}
          value={content}
        />
        <Pressable
          accessibilityLabel="Send message"
          accessibilityRole="button"
          disabled={!trimmed || sending}
          onPress={() => onSubmit(trimmed)}
          style={({ pressed }) => [
            styles.sendButton,
            {
              backgroundColor: accent,
              opacity: !trimmed || sending ? 0.48 : pressed ? 0.78 : 1,
            },
          ]}
        >
          {sending ? (
            <ZephLoader variant="messages" color="#fff" size="small" />
          ) : (
            <Send color="#fff" size={17} />
          )}
        </Pressable>
        {sendError ? (
          <View style={styles.retryRow}>
            <Text style={[styles.retryText, { color: theme.errorBannerText }]}>
              {sendError}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={sending}
              onPress={() => onSubmit(trimmed)}
            >
              <Text style={[styles.retryAction, { color: accent }]}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }
);
CommunityChatComposer.displayName = "CommunityChatComposer";

export function CommunityChatScreen() {
  const { user } = useSessionContext();
  const params = useLocalSearchParams();
  if (!communityChatUiEnabled) {
    return <Redirect href="/" />;
  }
  return (
    <CommunityChatTimelineScreen
      key={JSON.stringify([
        user?.id,
        params.slug,
        params["channel-id"],
        params["thread-id"],
      ])}
    />
  );
}

function CommunityChatTimelineScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    "channel-id"?: string | string[];
    "thread-id"?: string | string[];
    message?: string | string[];
    slug?: string | string[];
  }>();
  const slug =
    (Array.isArray(params.slug) ? params.slug[0] : params.slug) ?? "";
  const routeChannelId = params["channel-id"];
  const channelId =
    (Array.isArray(routeChannelId) ? routeChannelId[0] : routeChannelId) ?? "";
  const routeThreadId = params["thread-id"];
  const threadId =
    (Array.isArray(routeThreadId) ? routeThreadId[0] : routeThreadId) ?? null;
  const roomId = threadId ?? channelId;
  const anchorId =
    (Array.isArray(params.message) ? params.message[0] : params.message) ??
    null;
  const apiBase = getApiBaseUrl();
  const insets = useSafeAreaInsets();
  const { isDark, theme } = useAppTheme();
  const { user } = useSessionContext();
  const [detail, setDetail] = useState<CommunityDetail | null>(null);
  const [channels, setChannels] = useState<CommunityChatRoom[]>([]);
  const [room, setRoom] = useState<CommunityChatRoom | null>(null);
  const [threads, setThreads] = useState<CommunityChatThreadSummary[]>([]);
  const [messages, setMessages] = useState<CommunityChatMessage[]>([]);
  const [permissions, setPermissions] = useState<
    CommunityChatChannelsResponse["permissions"] | null
  >(null);
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped after a successful send so the memoized composer clears its draft
  // without the draft living in this screen's state (which would re-render the
  // whole timeline on every keystroke).
  const [composerResetKey, setComposerResetKey] = useState(0);
  // Explicit send state machine (audit S1-2): send no-ops unless idle or
  // failed. A single boolean let two rapid Enter presses race past the guard
  // before setSending(true) committed; the union plus its ref mirror make the
  // transition atomic with the in-flight clientId.
  type CommunityChatSendState =
    | { kind: "failed"; clientId: string; error: string }
    | { kind: "idle" }
    | { kind: "sending"; clientId: string };
  const [sendState, setSendState] = useState<CommunityChatSendState>({
    kind: "idle",
  });
  const sendStateRef = useRef<CommunityChatSendState>({ kind: "idle" });
  const [pending, setPending] = useState<{
    clientId: string;
    content: string;
    replyToId?: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [privateThreadOpen, setPrivateThreadOpen] = useState(false);
  const [atLatest, setAtLatest] = useState(true);
  const atLatestRef = useRef(true);
  const windowAtLiveTail = useRef(true);
  // Last scroll position for the pin-to-latest gate: a content size change
  // that lands while the reader is scrolled up must not yank them back to
  // the bottom.
  const lastOffsetY = useRef(0);
  const lastScrollAtMs = useRef(0);
  const draggingRef = useRef(false);
  const [newActivity, setNewActivity] = useState(false);
  const [replyTarget, setReplyTarget] = useState<CommunityChatMessage | null>(
    null
  );
  const [actionMessage, setActionMessage] =
    useState<CommunityChatMessage | null>(null);
  const [threadSource, setThreadSource] = useState<CommunityChatMessage | null>(
    null
  );
  const [messageActionMode, setMessageActionMode] = useState<
    "DELETE" | "EDIT" | null
  >(null);
  const [editContent, setEditContent] = useState("");
  const [mutatingMessage, setMutatingMessage] = useState(false);
  const [pins, setPins] = useState<CommunityChatMessage[] | null>(null);
  const [loadingPins, setLoadingPins] = useState(false);
  const [threadName, setThreadName] = useState("");
  const [creatingThread, setCreatingThread] = useState(false);
  const threadRequestId = useRef<string | null>(null);
  const landedAnchor = useRef<string | null>(null);
  const communityAccent = resolveCommunityAccentColor(
    detail?.community.accentColor,
    isDark
  );
  const listRef = useRef<FlatList<CommunityChatMessage>>(null);
  const composerRef = useRef<TextInputInstance>(null);
  const latestSequence = useRef("0");
  const latestChangeSequence = useRef("0");
  const paging = useRef(false);
  // Room generation: loadPage bumps this when it starts for a room, so a
  // late fetchLatest/loadOlder/send settle from the previous room drops
  // instead of merging old messages into the new room's timeline.
  const roomGenRef = useRef(0);
  const roomReady = room !== null;

  const options = useCallback(
    async () => ({
      apiBase,
      cookie: (await authClient.getCookie()) ?? undefined,
    }),
    [apiBase]
  );

  const readContext = useRef({ canRead: false, options, roomId, slug });
  const screenFocused = useRef(false);
  const readSequence = useRef("0");
  const viewedSequence = useRef("0");
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    readContext.current = {
      canRead: permissions?.isMember ?? false,
      options,
      roomId,
      slug,
    };
  }, [options, permissions?.isMember, roomId, slug]);
  useFocusEffect(
    useCallback(() => {
      screenFocused.current = true;
      return () => {
        screenFocused.current = false;
        if (readTimer.current) {
          clearTimeout(readTimer.current);
        }
        readTimer.current = null;
      };
    }, [])
  );
  const onViewableMessagesChanged = useCallback<
    NonNullable<FlatListProps<CommunityChatMessage>["onViewableItemsChanged"]>
  >(({ viewableItems }) => {
    if (
      !screenFocused.current ||
      AppState.currentState !== "active" ||
      !readContext.current.canRead
    ) {
      return;
    }
    for (const token of viewableItems) {
      if (
        token.isViewable &&
        BigInt(token.item.sequence) > BigInt(viewedSequence.current)
      ) {
        viewedSequence.current = token.item.sequence;
      }
    }
    if (
      readTimer.current ||
      BigInt(viewedSequence.current) <= BigInt(readSequence.current)
    ) {
      return;
    }
    readTimer.current = setTimeout(async () => {
      readTimer.current = null;
      if (
        !screenFocused.current ||
        AppState.currentState !== "active" ||
        !readContext.current.canRead
      ) {
        return;
      }
      const context = readContext.current;
      try {
        const result = await advanceCommunityChatRead(
          context.slug,
          context.roomId,
          viewedSequence.current,
          await context.options()
        );
        readSequence.current = result.readSequence;
      } catch {
        // A later visible-message update retries this private watermark.
      }
    }, 1000);
  }, []);

  const mergeMessages = useCallback(
    (incoming: CommunityChatMessage[], edge?: "newer" | "older") => {
      if (incoming.length === 0) {
        return;
      }
      for (const message of incoming) {
        if (BigInt(message.sequence) > BigInt(latestSequence.current)) {
          latestSequence.current = message.sequence;
          if (!atLatestRef.current) {
            setNewActivity(true);
          }
        }
        if (
          BigInt(message.changeSequence) > BigInt(latestChangeSequence.current)
        ) {
          latestChangeSequence.current = message.changeSequence;
        }
      }
      setMessages((current) => {
        const window = mergeCommunityChatTimeline(current, incoming, {
          edge: edge ?? (atLatestRef.current ? "newer" : "older"),
        });
        if (window.trimmedBefore) {
          setHasOlder(true);
        }
        if (window.trimmedAfter) {
          windowAtLiveTail.current = false;
          setNewActivity(true);
        }
        // Reuses row objects that render identically so a merge that changed
        // one row does not re-render the whole transcript.
        return stabilizeCommunityChatRows(
          current,
          window.messages.slice().reverse()
        );
      });
    },
    []
  );

  const fetchLatest = useCallback(async () => {
    const generation = roomGenRef.current;
    const requestOptions = await options();
    const page = await fetchCommunityChatMessages(
      slug,
      roomId,
      {
        after:
          latestSequence.current === "0" ? undefined : latestSequence.current,
        limit: HISTORY_LIMIT,
      },
      requestOptions
    );
    if (roomGenRef.current !== generation) {
      return;
    }
    setPermissions(page.permissions);
    setRoom(page.room);
    mergeMessages(page.messages);
  }, [mergeMessages, options, roomId, slug]);

  const loadPage = useCallback(async () => {
    if (!slug || !channelId) {
      return;
    }
    // Owns the room from here: any in-flight loader for the previous room
    // is stale the moment this starts, even before its response lands.
    roomGenRef.current += 1;
    const generation = roomGenRef.current;
    setLoading(true);
    setLoadError(null);
    setMessages([]);
    setReplyTarget(null);
    setPending(null);
    sendStateRef.current = { kind: "idle" };
    setSendState({ kind: "idle" });
    latestSequence.current = "0";
    latestChangeSequence.current = "0";
    try {
      const requestOptions = await options();
      const [communityDetail, chatChannels, page, chatThreads] =
        await Promise.all([
          fetchCommunityDetail(slug, requestOptions),
          fetchCommunityChatChannels(slug, requestOptions),
          fetchCommunityChatMessages(
            slug,
            roomId,
            { around: anchorId ?? undefined, limit: HISTORY_LIMIT },
            requestOptions
          ),
          fetchCommunityChatThreads(slug, channelId, requestOptions),
        ]);
      if (
        threadId
          ? page.room.parentRoomId !== channelId
          : page.room.id !== channelId
      ) {
        throw new Error("This conversation is not available");
      }
      if (roomGenRef.current !== generation) {
        return;
      }
      setDetail(communityDetail);
      setChannels(chatChannels.channels);
      setThreads(chatThreads.threads);
      setPermissions(page.permissions);
      setRoom(page.room);
      setMessages(
        stabilizeCommunityChatRows([], [...page.messages].slice().reverse())
      );
      setHasOlder(page.nextBeforeSequence !== null);
      latestSequence.current = page.room.nextSequence;
      latestChangeSequence.current = page.room.changeSequence;
      atLatestRef.current = !anchorId;
      windowAtLiveTail.current =
        !anchorId || page.messages.at(-1)?.sequence === page.room.nextSequence;
      setAtLatest(!anchorId);
      setNewActivity(
        Boolean(
          anchorId && page.messages.at(-1)?.sequence !== page.room.nextSequence
        )
      );
    } catch (error) {
      if (roomGenRef.current !== generation) {
        return;
      }
      setLoadError(
        error instanceof Error
          ? error.message
          : "Couldn't open this conversation"
      );
    } finally {
      if (roomGenRef.current === generation) {
        setLoading(false);
      }
    }
  }, [anchorId, channelId, options, roomId, slug, threadId]);

  // Remember this channel as the community's last-visited chat destination so
  // the Posts tab's Chat button deep-links back here, mirroring web's
  // rememberSection on every chat view (community-page.tsx). A thread view
  // remembers its parent channel, like web's communityChatLocation.
  useEffect(() => {
    if (slug && channelId) {
      rememberCommunityChatHref(user?.id, slug, `/a/${slug}/chat/${channelId}`);
    }
  }, [channelId, slug, user?.id]);

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
    const generation = roomGenRef.current;
    try {
      const page = await fetchCommunityChatMessages(
        slug,
        roomId,
        { before: oldest.sequence, limit: HISTORY_LIMIT },
        await options()
      );
      if (roomGenRef.current !== generation) {
        return;
      }
      setHasOlder(page.nextBeforeSequence !== null);
      mergeMessages(page.messages, "older");
    } catch (error) {
      if (roomGenRef.current !== generation) {
        return;
      }
      setActionError(
        error instanceof Error
          ? error.message
          : "Couldn't load earlier messages"
      );
    } finally {
      paging.current = false;
      setLoadingOlder(false);
    }
  }, [hasOlder, mergeMessages, messages, options, roomId, slug]);

  useFocusEffect(
    useCallback(() => {
      if (loading || !roomReady) {
        return;
      }
      const controller = new AbortController();
      const connect = async () => {
        try {
          await readSseStream({
            baseFetch: streamingFetch,
            eventName: ["change", "reset", "access-revoked"],
            // Live credentials per attempt: the old code snapshotted the
            // cookie at focus time, so every backoff retry after a rotation
            // replayed the stale credential until the stream died.
            getCookie: () => authClient.getCookie(),
            onEvent: async (event, data) => {
              if (event === "access-revoked") {
                setAccessRevoked(true);
                setMessages([]);
                setThreads([]);
                setPending(null);
                sendStateRef.current = { kind: "idle" };
                setSendState({ kind: "idle" });
                setReplyTarget(null);
                setActionMessage(null);
                setDetailsOpen(false);
                setPrivateThreadOpen(false);
                setChannelsOpen(false);
                setMessageActionMode(null);
                setEditContent("");
                setPins(null);
                setThreadSource(null);
                setThreadName("");
                setRoom(null);
                setPermissions(null);
                setChannels([]);
                controller.abort();
                setLoadError("Your access to this conversation changed.");
                return;
              }
              if (event === "change") {
                const change = data as CommunityChatChange;
                // Explicit replay handling (community-chat-events): an inline
                // message merges without a page refetch, a bare ref refetches
                // that message, and only unknown shapes reload the page, so a
                // busy channel no longer refetches on every event.
                const stale = isStaleCommunityChatChange(
                  change,
                  latestChangeSequence.current
                );
                if (
                  change.changeSequence &&
                  BigInt(change.changeSequence) >
                    BigInt(latestChangeSequence.current)
                ) {
                  latestChangeSequence.current = change.changeSequence;
                }
                for (const action of classifyCommunityChatChange(change)) {
                  if (action.kind === "ignore") {
                    continue;
                  }
                  if (action.kind === "refresh-threads") {
                    try {
                      const result = await fetchCommunityChatThreads(
                        slug,
                        channelId,
                        await options()
                      );
                      setThreads(result.threads);
                    } catch {
                      setActionError(
                        "Couldn't refresh channel threads. Please try again."
                      );
                    }
                    continue;
                  }
                  if (action.kind === "merge") {
                    if (!stale) {
                      mergeMessages([action.message]);
                    }
                    continue;
                  }
                  if (action.kind === "refresh-message") {
                    try {
                      const requestOptions = await options();
                      const result = await fetchCommunityChatMessage(
                        slug,
                        roomId,
                        action.messageId,
                        requestOptions
                      );
                      mergeMessages([result.message]);
                    } catch {
                      setActionError("Couldn't refresh this message.");
                    }
                    continue;
                  }
                  if (!stale) {
                    try {
                      await fetchLatest();
                    } catch {
                      setActionError("Reconnecting to this conversation…");
                    }
                  }
                }
                return;
              }
              if (event === "reset") {
                try {
                  await fetchLatest();
                } catch {
                  setActionError("Reconnecting to this conversation…");
                }
              }
            },
            onUnauthorized: () => {
              // oxlint-disable-next-line no-void -- Sign out before the stream reconnects with stale credentials.
              void authClient.signOut();
              return false;
            },
            signal: controller.signal,
            url: `${apiBase}${communityChatUrl(slug, roomId, `/events?after=${encodeURIComponent(latestChangeSequence.current)}`)}`,
          });
        } catch {
          if (!controller.signal.aborted) {
            setActionError(
              "Live updates are reconnecting. Your messages are still here."
            );
          }
        }
      };
      // oxlint-disable-next-line no-void -- Focus effect starts the cancellable event stream.
      void connect();
      const timer = setInterval(async () => {
        try {
          await fetchLatest();
        } catch {
          setActionError("Reconnecting to this conversation…");
        }
      }, CHAT_RECONCILE_MS);
      return () => {
        clearInterval(timer);
        controller.abort();
      };
    }, [
      apiBase,
      channelId,
      fetchLatest,
      loading,
      mergeMessages,
      options,
      roomId,
      roomReady,
      slug,
    ])
  );

  useEffect(() => {
    if (loading || !anchorId || landedAnchor.current === anchorId) {
      return;
    }
    const index = messages.findIndex((message) => message.id === anchorId);
    if (index === -1) {
      return;
    }
    landedAnchor.current = anchorId;
    requestAnimationFrame(() =>
      listRef.current?.scrollToIndex({
        animated: false,
        index,
        viewPosition: 0.5,
      })
    );
  }, [anchorId, loading, messages]);

  const jumpToLatest = useCallback(async () => {
    try {
      const page = await fetchCommunityChatMessages(
        slug,
        roomId,
        { limit: HISTORY_LIMIT },
        await options()
      );
      atLatestRef.current = true;
      windowAtLiveTail.current = true;
      setAtLatest(true);
      setNewActivity(false);
      setMessages((current) =>
        stabilizeCommunityChatRows(current, page.messages.slice().reverse())
      );
      setHasOlder(page.nextBeforeSequence !== null);
      latestSequence.current = page.room.nextSequence;
      latestChangeSequence.current = page.room.changeSequence;
      requestAnimationFrame(() =>
        listRef.current?.scrollToOffset({ animated: false, offset: 0 })
      );
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Couldn't load the latest messages"
      );
    }
  }, [options, roomId, slug]);

  const reactToMessage = useCallback(
    async (message: CommunityChatMessage, emoji: string) => {
      setActionMessage(null);
      try {
        const requestOptions = await options();
        await updateCommunityChatReaction(
          slug,
          roomId,
          {
            emoji,
            messageId: message.id,
            reacted: !message.reactions?.some(
              (reaction) => reaction.emoji === emoji && reaction.reacted
            ),
          },
          requestOptions
        );
        const result = await fetchCommunityChatMessage(
          slug,
          roomId,
          message.id,
          requestOptions
        );
        mergeMessages([result.message]);
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : "Couldn't update your reaction"
        );
      }
    },
    [mergeMessages, options, roomId, slug]
  );

  const createThread = useCallback(async () => {
    if (!threadSource || !threadName.trim() || creatingThread) {
      return;
    }
    threadRequestId.current ??= randomUUID();
    setCreatingThread(true);
    setActionError(null);
    try {
      const { thread } = await createCommunityChatPublicThread(
        slug,
        channelId,
        {
          clientId: threadRequestId.current,
          name: threadName.trim(),
          sourceMessageId: threadSource.id,
        },
        await options()
      );
      setThreadSource(null);
      router.push(threadUrl(slug, channelId, thread.id));
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Couldn't create this thread"
      );
    } finally {
      setCreatingThread(false);
    }
  }, [
    channelId,
    creatingThread,
    options,
    router,
    slug,
    threadName,
    threadSource,
  ]);

  async function applyMessageMutation() {
    if (!actionMessage || !messageActionMode || mutatingMessage) {
      return;
    }
    setMutatingMessage(true);
    setActionError(null);
    try {
      const result = await mutateCommunityChatMessage(
        slug,
        actionMessage.id,
        {
          content:
            messageActionMode === "EDIT" ? editContent.trim() : undefined,
          revision: actionMessage.revision,
        },
        messageActionMode,
        await options()
      );
      mergeMessages([result.message]);
      setActionMessage(null);
      setMessageActionMode(null);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Couldn’t update this message."
      );
      if (error instanceof CommunityChatApiError && error.status === 409) {
        try {
          const latest = await fetchCommunityChatMessage(
            slug,
            roomId,
            actionMessage.id,
            await options()
          );
          mergeMessages([latest.message]);
          if (latest.message.deletedAt) {
            setActionMessage(null);
            setMessageActionMode(null);
          } else {
            setActionMessage(latest.message);
            setActionError(
              "This message changed. The preview above is current; review it before saving again."
            );
          }
        } catch {
          setActionError(
            "Couldn’t refresh this message. Close and reopen its actions to retry."
          );
        }
      }
    } finally {
      setMutatingMessage(false);
    }
  }

  async function toggleMessagePin() {
    if (!actionMessage || mutatingMessage) {
      return;
    }
    setMutatingMessage(true);
    setActionError(null);
    try {
      await updateCommunityChatPin(
        slug,
        roomId,
        { messageId: actionMessage.id, pinned: !actionMessage.pinned },
        await options()
      );
      const result = await fetchCommunityChatMessage(
        slug,
        roomId,
        actionMessage.id,
        await options()
      );
      mergeMessages([result.message]);
      setActionMessage(null);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Couldn’t update this pin."
      );
    } finally {
      setMutatingMessage(false);
    }
  }

  async function openPins() {
    if (loadingPins) {
      return;
    }
    setLoadingPins(true);
    setActionError(null);
    try {
      const result = await fetchCommunityChatPins(
        slug,
        roomId,
        await options()
      );
      setPins(result.messages);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Couldn’t load pinned messages."
      );
    } finally {
      setLoadingPins(false);
    }
  }

  // Takes the composer text as an argument so the memoized composer owns the
  // draft: typing never touches this screen's state, so it never re-renders
  // the timeline. The pending/error restore only reuses the previous attempt
  // when the text is unchanged since the failure.
  const submit = useCallback(
    async (text: string) => {
      const state = sendStateRef.current;
      if (state.kind !== "idle" && state.kind !== "failed") {
        return;
      }
      const trimmed = text.trim();
      const outgoing =
        pending && pending.content === trimmed
          ? pending
          : {
              clientId: randomUUID(),
              content: trimmed,
              replyToId: replyTarget?.id,
            };
      if (!outgoing.content || !permissions?.canSend) {
        return;
      }
      setPending(outgoing);
      const sending: CommunityChatSendState = {
        clientId: outgoing.clientId,
        kind: "sending",
      };
      sendStateRef.current = sending;
      setSendState(sending);
      // The room may change while the send is in flight: a late success must
      // not merge this room's message into the next room's timeline.
      const generation = roomGenRef.current;
      try {
        const result = await sendCommunityChatMessage(
          slug,
          roomId,
          outgoing,
          await options()
        );
        if (roomGenRef.current !== generation) {
          return;
        }
        if (!atLatestRef.current) {
          await jumpToLatest();
        }
        if (atLatestRef.current) {
          mergeMessages([result.message]);
        } else {
          setNewActivity(true);
        }
        setPending(null);
        setReplyTarget(null);
        setComposerResetKey((value) => value + 1);
        const idle: CommunityChatSendState = { kind: "idle" };
        sendStateRef.current = idle;
        setSendState(idle);
        if (atLatestRef.current) {
          requestAnimationFrame(() =>
            listRef.current?.scrollToOffset({ animated: false, offset: 0 })
          );
        }
      } catch (error) {
        if (roomGenRef.current !== generation) {
          return;
        }
        setPending(outgoing);
        const failed: CommunityChatSendState = {
          clientId: outgoing.clientId,
          error: error instanceof Error ? error.message : "Message didn't send",
          kind: "failed",
        };
        sendStateRef.current = failed;
        setSendState(failed);
      }
    },
    [
      roomId,
      mergeMessages,
      options,
      pending,
      replyTarget,
      jumpToLatest,
      permissions?.canSend,
      slug,
    ]
  );

  // Memoized timeline list callbacks (audit P1-1, P1-2): the inline
  // renderItem, ListEmpty, ListFooter and onScroll used to be recreated every
  // render, defeating the memo on each row. Stable identities here mean a new
  // message only re-renders the rows it touches.
  const messageKeyExtractor = useCallback(
    (message: CommunityChatMessage) => message.id,
    []
  );
  const threadSourceIds = useMemo(
    () =>
      new Set(
        threads
          .map((thread) => thread.sourceMessage?.id)
          .filter((id): id is string => typeof id === "string")
      ),
    [threads]
  );
  const openMessageActions = useCallback(
    (message: CommunityChatMessage) => setActionMessage(message),
    []
  );
  const openMessageThread = useCallback(
    (message: CommunityChatMessage) => {
      const thread = threads.find(
        (entry) => entry.sourceMessage?.id === message.id
      );
      if (thread) {
        router.push(threadUrl(slug, channelId, thread.room.id));
      }
    },
    [channelId, router, slug, threads]
  );
  const renderMessage = useCallback<
    NonNullable<FlatListProps<CommunityChatMessage>["renderItem"]>
  >(
    ({ index, item }) => {
      const previous = messages[index + 1];
      const grouped = Boolean(
        previous &&
        previous.senderId === item.senderId &&
        Math.abs(
          new Date(previous.createdAt).getTime() -
            new Date(item.createdAt).getTime()
        ) <
          5 * 60_000
      );
      return (
        <CommunityChatMessageRow
          accent={communityAccent}
          apiBase={apiBase}
          canReact={permissions?.canSend ?? false}
          cardBg={theme.cardBg}
          cardBorder={theme.cardBorder}
          community={detail?.community ?? null}
          dividerText={theme.dividerText}
          grouped={grouped}
          hasThread={threadSourceIds.has(item.id)}
          inputText={theme.inputText}
          message={item}
          onOpenActions={openMessageActions}
          onOpenThread={openMessageThread}
          onReact={reactToMessage}
          showThreadLink={!threadId}
        />
      );
    },
    [
      apiBase,
      communityAccent,
      detail?.community,
      messages,
      openMessageActions,
      openMessageThread,
      permissions?.canSend,
      reactToMessage,
      theme.cardBg,
      theme.cardBorder,
      theme.dividerText,
      theme.inputText,
      threadId,
      threadSourceIds,
    ]
  );
  const listEmpty = useMemo(
    () => (
      <View style={styles.emptyMessages}>
        {detail ? (
          <CommunityAvatar community={detail.community} size={54} />
        ) : null}
        <Text style={[styles.stateTitle, { color: theme.inputText }]}>
          A fresh place to start
        </Text>
        <Text style={[styles.stateBody, { color: theme.dividerText }]}>
          {permissions?.canSend
            ? "Say hello to the community."
            : "Community conversations will appear here."}
        </Text>
      </View>
    ),
    [detail, permissions?.canSend, theme.dividerText, theme.inputText]
  );
  const listFooter = useMemo(
    () => <ZephLoader variant="messages" color={communityAccent} />,
    [communityAccent]
  );
  const handleClearReply = useCallback(() => {
    setReplyTarget(null);
    setPending(null);
  }, []);
  // Pinned to the live tail only while the reader is actually there. An
  // unconditional snap fires on every mounting image as well, yanking a
  // reader who just scrolled up back to the bottom.
  const handleContentSizeChange = useCallback(() => {
    if (!atLatestRef.current) {
      return;
    }
    if (
      !shouldSnapTimelineToLatest({
        dragging: draggingRef.current,
        lastOffsetY: lastOffsetY.current,
        lastScrollAtMs: lastScrollAtMs.current,
        nowMs: Date.now(),
      })
    ) {
      return;
    }
    listRef.current?.scrollToOffset({ animated: false, offset: 0 });
  }, []);
  const handleTimelineScroll = useCallback<
    NonNullable<FlatListProps<CommunityChatMessage>["onScroll"]>
  >((event) => {
    lastOffsetY.current = event.nativeEvent.contentOffset.y;
    lastScrollAtMs.current = Date.now();
    const nearLatest =
      windowAtLiveTail.current && event.nativeEvent.contentOffset.y < 64;
    atLatestRef.current = nearLatest;
    setAtLatest(nearLatest);
    if (nearLatest) {
      setNewActivity(false);
    }
  }, []);
  const handleBeginDrag = useCallback(() => {
    draggingRef.current = true;
    lastScrollAtMs.current = Date.now();
  }, []);
  const handleEndDrag = useCallback(() => {
    draggingRef.current = false;
    lastScrollAtMs.current = Date.now();
  }, []);
  const handleScrollToIndexFailed = useCallback<
    NonNullable<FlatListProps<CommunityChatMessage>["onScrollToIndexFailed"]>
  >(
    (info) =>
      listRef.current?.scrollToOffset({
        animated: false,
        offset: Math.max(0, info.averageItemLength * info.index),
      }),
    []
  );
  const handleEndReached = useCallback(() => {
    void loadOlder();
  }, [loadOlder]);

  if (accessRevoked) {
    return (
      <View style={[styles.state, { backgroundColor: theme.containerBg }]}>
        <Text
          accessibilityRole="alert"
          style={[styles.stateBody, { color: theme.inputText }]}
        >
          Your access to this conversation changed.
        </Text>
        <StatusActionButton
          label="Back to community"
          onPress={() => router.replace(`/a/${slug}`)}
        />
      </View>
    );
  }

  const channelName = room?.name ?? "Community chat";
  const sending = sendState.kind === "sending";
  const sendError = sendState.kind === "failed" ? sendState.error : null;
  const parentChannelName =
    channels.find((channel) => channel.id === channelId)?.name ?? "channel";
  const threadRoot = threadId
    ? threads.find((thread) => thread.room.id === threadId)?.sourceMessage
    : null;
  const inputStyle = premiumInput(isDark, false);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
      style={[
        styles.root,
        { backgroundColor: theme.containerBg, paddingTop: insets.top },
      ]}
    >
      <View
        style={[styles.compactHeader, { borderBottomColor: theme.cardBorder }]}
      >
        <Pressable
          accessibilityLabel={
            threadId ? "Back to channel" : "Open community sidebar"
          }
          accessibilityRole="button"
          onPress={() => {
            if (threadId) {
              router.replace(chatUrl(slug, channelId));
            } else {
              setChannelsOpen(true);
            }
          }}
          style={styles.roomIconButton}
        >
          {threadId ? (
            <ArrowLeft color={theme.inputText} size={20} />
          ) : (
            <PanelLeft color={theme.inputText} size={20} />
          )}
        </Pressable>
        <Pressable
          accessibilityLabel={`Open community sidebar, currently ${channelName}`}
          accessibilityState={{ expanded: channelsOpen }}
          accessibilityRole="button"
          onPress={() => setChannelsOpen(true)}
          style={[
            styles.flex,
            {
              alignItems: "center",
              flexDirection: "row",
              gap: 10,
              minHeight: 48,
            },
          ]}
        >
          {detail ? (
            <CommunityAvatar community={detail.community} size={34} />
          ) : null}
          <View style={styles.flex}>
            <Text
              numberOfLines={1}
              style={[styles.communityName, { color: theme.inputText }]}
            >
              {detail?.community.name ?? "Community"}
            </Text>
            <View
              style={{ alignItems: "center", flexDirection: "row", gap: 4 }}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.channelTopic,
                  { color: theme.dividerText, flexShrink: 1 },
                ]}
              >
                {threadId ? "Thread" : "Chat"} · {channelName}
              </Text>
              <ChevronDown color={theme.dividerText} size={12} />
            </View>
          </View>
        </Pressable>
        <Pressable
          accessibilityLabel="Conversation details and tools"
          accessibilityRole="button"
          onPress={() => setDetailsOpen(true)}
          style={styles.roomIconButton}
        >
          <MoreHorizontal color={theme.dividerText} size={21} />
        </Pressable>
      </View>
      {actionError ? (
        <View
          style={[
            styles.retryRow,
            { paddingHorizontal: 16, paddingVertical: 8 },
          ]}
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.retryText, { color: theme.errorBannerText }]}>
            {actionError}
          </Text>
          <Pressable
            accessibilityLabel="Dismiss error"
            onPress={() => setActionError(null)}
          >
            <X color={theme.dividerText} size={18} />
          </Pressable>
        </View>
      ) : null}
      {loading ? (
        <CommunityChatLoading />
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
            {...LIST_VIRTUALIZATION_PROPS}
            inverted
            contentContainerStyle={styles.messageList}
            data={messages}
            keyExtractor={messageKeyExtractor}
            ListEmptyComponent={listEmpty}
            ListFooterComponent={loadingOlder ? listFooter : undefined}
            onViewableItemsChanged={onViewableMessagesChanged}
            viewabilityConfig={CHAT_VIEWABILITY_CONFIG}
            onContentSizeChange={handleContentSizeChange}
            onScroll={handleTimelineScroll}
            onScrollBeginDrag={handleBeginDrag}
            onScrollEndDrag={handleEndDrag}
            scrollEventThrottle={100}
            onScrollToIndexFailed={handleScrollToIndexFailed}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.3}
            ref={listRef}
            renderItem={renderMessage}
            showsVerticalScrollIndicator={false}
          />
          {!atLatest ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void jumpToLatest()}
              style={{
                alignItems: "center",
                alignSelf: "center",
                backgroundColor: theme.cardBg,
                borderColor: theme.cardBorder,
                borderRadius: 22,
                borderWidth: StyleSheet.hairlineWidth,
                flexDirection: "row",
                gap: 6,
                marginVertical: 6,
                minHeight: 40,
                paddingHorizontal: 16,
              }}
            >
              <ArrowDown color={communityAccent} size={15} />
              <Text style={[styles.retryAction, { color: communityAccent }]}>
                {newActivity
                  ? "New messages · Jump to latest"
                  : "Jump to latest"}
              </Text>
            </Pressable>
          ) : null}
          {!permissions?.canSend ? (
            <View
              style={[
                styles.readOnly,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: theme.cardBorder,
                  marginBottom: Math.max(insets.bottom, 8),
                },
              ]}
            >
              {replyTarget ? (
                <View style={[styles.retryRow, { width: "100%" }]}>
                  <Reply color={communityAccent} size={14} />
                  <Text
                    numberOfLines={1}
                    style={[styles.retryText, { color: theme.dividerText }]}
                  >
                    Replying to {userLabel(replyTarget)}
                  </Text>
                  <Pressable
                    accessibilityLabel="Cancel reply"
                    onPress={handleClearReply}
                  >
                    <X color={theme.dividerText} size={18} />
                  </Pressable>
                </View>
              ) : null}
              <Text style={[styles.readOnlyText, { color: theme.dividerText }]}>
                {permissions?.writeRestriction === "TIMEOUT"
                  ? "You’re timed out. You can read along until your timeout ends."
                  : permissions?.writeRestriction === "BANNED"
                    ? "You can read public conversations, but can’t contribute to this community."
                    : permissions?.writeRestriction === "PENDING"
                      ? "Your membership is pending approval. You can read along for now."
                      : permissions?.writeRestriction === "ARCHIVED"
                        ? "This conversation is archived. Its history is still available."
                        : permissions?.writeRestriction === "LOCKED"
                          ? "This conversation is locked. New messages are paused."
                          : !permissions?.isMember
                            ? "Join this community to add to the conversation."
                            : room?.channelType === "ANNOUNCEMENT"
                              ? "Only community staff can post updates here."
                              : "You can read this conversation, but can’t send messages right now."}
              </Text>
            </View>
          ) : (
            <CommunityChatComposer
              accent={communityAccent}
              channelName={channelName}
              inputRef={composerRef}
              onClearReply={handleClearReply}
              onSubmit={(text) => void submit(text)}
              replyingToName={replyTarget ? userLabel(replyTarget) : null}
              resetKey={composerResetKey}
              sendError={sendError}
              sending={sending}
            />
          )}
        </>
      )}

      {detailsOpen && !loadError ? (
        <DialogPanel
          description={
            room?.topic ||
            `A conversation in ${detail?.community.name ?? "your community"}.`
          }
          onClose={() => setDetailsOpen(false)}
          title={channelName}
        >
          {!threadId && permissions?.canSend ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDetailsOpen(false);
                setPrivateThreadOpen(true);
              }}
              style={styles.actionRow}
            >
              <LockKeyhole color={communityAccent} size={18} />
              <Text style={[styles.channelName, { color: theme.inputText }]}>
                Start a private thread
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={loadingPins}
            onPress={() => {
              setDetailsOpen(false);
              void openPins();
            }}
            style={styles.actionRow}
          >
            <Pin color={communityAccent} size={18} />
            <Text style={[styles.channelName, { color: theme.inputText }]}>
              Pinned messages
            </Text>
          </Pressable>
          {permissions?.canManage && room?.kind === "CHANNEL" ? (
            <CommunityChannelSettingsButton
              canArchive={channels.length > 1}
              onUpdated={(updated) => {
                setChannels((current) =>
                  current
                    .map((channel) =>
                      channel.id === updated.id ? updated : channel
                    )
                    .filter((channel) => !channel.archived)
                    .slice()
                    .sort((left, right) => left.sortOrder - right.sortOrder)
                );
                setRoom(updated);
                if (updated.archived) {
                  setDetailsOpen(false);
                  router.replace({
                    params: { slug },
                    pathname: "/a/[slug]/chat",
                  });
                }
              }}
              options={options}
              room={room}
              slug={slug}
            />
          ) : null}
          {threadId && permissions?.isMember ? (
            <CommunityThreadFollowButton
              key={
                messages.find((message) => message.senderId === user?.id)?.id ??
                "new"
              }
              options={options}
              slug={slug}
              threadId={threadId}
            />
          ) : null}
          {threadRoot ? (
            <View
              style={{
                borderBottomColor: theme.cardBorder,
                borderBottomWidth: StyleSheet.hairlineWidth,
                paddingHorizontal: 18,
                paddingVertical: 10,
              }}
            >
              <Text style={[styles.channelTopic, { color: theme.dividerText }]}>
                Thread started by {userLabel(threadRoot)}
              </Text>
              <Text
                numberOfLines={2}
                style={[styles.messageText, { color: theme.inputText }]}
              >
                {threadRoot.payload?.type === "text"
                  ? threadRoot.payload.content
                  : "Original message deleted. Replies remain in this thread."}
              </Text>
            </View>
          ) : null}
        </DialogPanel>
      ) : null}
      {!loadError && pins ? (
        <DialogPanel
          description="Messages community staff saved in this conversation."
          onClose={() => setPins(null)}
          title="Pinned messages"
        >
          {pins.length ? (
            <View>
              {pins.map((message) => (
                <Pressable
                  accessibilityRole="button"
                  key={message.id}
                  onPress={() => {
                    setPins(null);
                    if (threadId) {
                      router.push({
                        params: {
                          "channel-id": channelId,
                          message: message.id,
                          slug,
                          "thread-id": threadId,
                        },
                        pathname:
                          "/a/[slug]/chat/[channel-id]/threads/[thread-id]",
                      });
                    } else {
                      router.push({
                        params: {
                          "channel-id": channelId,
                          message: message.id,
                          slug,
                        },
                        pathname: "/a/[slug]/chat/[channel-id]",
                      });
                    }
                  }}
                  style={styles.actionRow}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text
                      style={[styles.channelName, { color: theme.inputText }]}
                    >
                      {userLabel(message)}
                    </Text>
                    <Text
                      numberOfLines={4}
                      style={[styles.messageText, { color: theme.dividerText }]}
                    >
                      {message.payload?.type === "text"
                        ? message.payload.content
                        : "Message"}
                    </Text>
                    <Text
                      style={[styles.channelTopic, { color: communityAccent }]}
                    >
                      Jump to message →
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={[styles.messageText, { color: theme.dividerText }]}>
              No pinned messages yet.
            </Text>
          )}
        </DialogPanel>
      ) : null}
      {!loadError && actionMessage ? (
        <DialogPanel
          description={`A message from ${userLabel(actionMessage)}`}
          busy={mutatingMessage}
          onClose={() => {
            setActionMessage(null);
            setMessageActionMode(null);
            setActionError(null);
          }}
          title={
            messageActionMode === "EDIT"
              ? "Edit message"
              : messageActionMode === "DELETE"
                ? "Delete message?"
                : "Message actions"
          }
        >
          <Text
            numberOfLines={3}
            style={[
              styles.messageText,
              { color: theme.dividerText, marginBottom: 16 },
            ]}
          >
            {actionMessage.payload?.type === "text"
              ? actionMessage.payload.content
              : "Message"}
          </Text>
          {messageActionMode ? (
            <View style={{ gap: 12 }}>
              {messageActionMode === "EDIT" ? (
                <TextInput
                  accessibilityLabel="Edit message"
                  autoFocus
                  editable={!mutatingMessage}
                  maxLength={4000}
                  multiline
                  onChangeText={setEditContent}
                  placeholderTextColor={inputStyle.placeholder}
                  style={{
                    backgroundColor: inputStyle.background,
                    borderRadius: 14,
                    boxShadow: inputStyle.shadows,
                    color: inputStyle.text,
                    fontFamily: "SofiaProReg",
                    minHeight: 100,
                    padding: 12,
                    textAlignVertical: "top",
                  }}
                  value={editContent}
                />
              ) : (
                <Text
                  style={[styles.messageText, { color: theme.dividerText }]}
                >
                  The message becomes a deleted-message marker. Existing thread
                  replies remain available.
                </Text>
              )}
              <StatusActionButton
                disabled={
                  mutatingMessage ||
                  (messageActionMode === "EDIT" && !editContent.trim())
                }
                label={
                  mutatingMessage
                    ? "Saving…"
                    : messageActionMode === "EDIT"
                      ? "Save changes"
                      : "Delete message"
                }
                onPress={() => void applyMessageMutation()}
              />
              <Pressable
                accessibilityRole="button"
                disabled={mutatingMessage}
                onPress={() => {
                  setMessageActionMode(null);
                  setActionError(null);
                }}
                style={styles.actionRow}
              >
                <Text style={[styles.channelName, { color: theme.inputText }]}>
                  Cancel
                </Text>
              </Pressable>
            </View>
          ) : (
            <CommunityChatMessageActions
              accent={communityAccent}
              gating={{
                canManage: permissions?.canManage ?? false,
                canSend: permissions?.canSend ?? false,
                hasThread: threads.some(
                  (thread) => thread.sourceMessage?.id === actionMessage.id
                ),
                isOwn: actionMessage.senderId === user?.id,
                pinned: actionMessage.pinned ?? false,
                threadId,
              }}
              message={actionMessage}
              onCopyLink={() => {
                const link = `asocialmedia://a/${slug}/chat/${channelId}?message=${actionMessage.id}`;
                const copy = async () => {
                  try {
                    await Clipboard.setStringAsync(link);
                    setActionMessage(null);
                    toast({ title: "Message link copied" });
                  } catch {
                    setActionError(
                      "Couldn't copy the message link. Please try again."
                    );
                  }
                };
                void copy();
              }}
              onDelete={() => {
                setMessageActionMode("DELETE");
                setActionError(null);
              }}
              onEdit={() => {
                setEditContent(
                  actionMessage.payload?.type === "text"
                    ? actionMessage.payload.content
                    : ""
                );
                setMessageActionMode("EDIT");
                setActionError(null);
              }}
              onPin={() => void toggleMessagePin()}
              onReact={(emoji) => void reactToMessage(actionMessage, emoji)}
              onReply={() => {
                setReplyTarget(actionMessage);
                setPending(null);
                setActionMessage(null);
                requestAnimationFrame(() => composerRef.current?.focus());
              }}
              onStartThread={() => {
                setThreadSource(actionMessage);
                setThreadName(
                  actionMessage.payload?.type === "text"
                    ? (actionMessage.payload.content
                        .split("\n")[0]
                        ?.slice(0, 64) ?? "")
                    : ""
                );
                threadRequestId.current = randomUUID();
                setActionMessage(null);
                setActionError(null);
              }}
            />
          )}
          {actionError ? (
            <Text
              accessibilityRole="alert"
              style={[styles.retryText, { color: theme.errorBannerText }]}
            >
              {actionError}
            </Text>
          ) : null}
        </DialogPanel>
      ) : null}
      {!loadError && threadSource ? (
        <DialogPanel
          busy={creatingThread}
          description={`Everyone with access to ${parentChannelName} can read and join this thread.`}
          onClose={() => setThreadSource(null)}
          title="Start a thread"
        >
          <Text
            numberOfLines={3}
            style={[
              styles.messageText,
              { color: theme.dividerText, marginBottom: 16 },
            ]}
          >
            {threadSource.payload?.type === "text"
              ? threadSource.payload.content
              : "Message"}
          </Text>
          <Text
            style={[
              styles.channelName,
              { color: theme.inputText, marginBottom: 8 },
            ]}
          >
            Thread name
          </Text>
          <TextInput
            accessibilityLabel="Thread name"
            autoFocus
            editable={!creatingThread}
            maxLength={64}
            onChangeText={setThreadName}
            placeholder="Give this conversation a name"
            placeholderTextColor={inputStyle.placeholder}
            style={{
              backgroundColor: inputStyle.background,
              borderRadius: 12,
              boxShadow: inputStyle.shadows,
              color: inputStyle.text,
              fontFamily: "SofiaProReg",
              marginBottom: 16,
              minHeight: 48,
              paddingHorizontal: 12,
            }}
            value={threadName}
          />
          {actionError ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[
                styles.retryText,
                { color: theme.errorBannerText, marginBottom: 12 },
              ]}
            >
              {actionError}
            </Text>
          ) : null}
          <StatusActionButton
            disabled={creatingThread || !threadName.trim()}
            label={creatingThread ? "Starting…" : "Start thread"}
            onPress={() => void createThread()}
          />
        </DialogPanel>
      ) : null}
      {privateThreadOpen && !loadError && !accessRevoked && user ? (
        <CommunityPrivateThreadDialog
          slug={slug}
          channelId={channelId}
          userId={user.id}
          options={options}
          onClose={() => setPrivateThreadOpen(false)}
          onCreated={(id) => {
            setPrivateThreadOpen(false);
            router.push(threadUrl(slug, channelId, id));
          }}
        />
      ) : null}
      {channelsOpen ? (
        <CommunityNavigationDrawer
          about={
            detail && detail.community.type !== "PRIVATE" ? (
              <CommunityAboutCard detail={detail} />
            ) : undefined
          }
          active="chat"
          accentColor={detail?.community.accentColor ?? null}
          channelId={channelId}
          channels={channels}
          communityName={detail?.community.name ?? "Community"}
          onClose={() => setChannelsOpen(false)}
          slug={slug}
          threadId={threadId}
          threads={threads}
          viewerId={user?.id}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 48,
    paddingVertical: 10,
  },
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
    gap: 6,
    minHeight: 64,
    paddingHorizontal: 8,
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
    fontSize: 16,
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
    paddingRight: 36,
  },
  messageRow: {
    flexDirection: "row",
    gap: 9,
    paddingBottom: 7,
    paddingTop: 9,
  },
  messageText: { fontFamily: "SofiaProReg", fontSize: 15, lineHeight: 22 },
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
    height: 44,
    justifyContent: "center",
    width: 44,
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
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  senderName: { fontFamily: "SofiaProBold", fontSize: 13, maxWidth: "70%" },
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
