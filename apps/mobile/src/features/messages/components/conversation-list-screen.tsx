// The conversation list: who each conversation is with, what was last said, when,
// and how many are unread.
//
// Ported from apps/web/src/components/messages/conversation-list.tsx and
// conversation-list-item.tsx. The preview line is the interesting part: the server
// stores only ciphertext, so the one-line description of a chat the reader has not
// opened is derived here, on the client, from the decrypted payload. Each row's
// last message is decrypted through the same scheduler the thread uses, so opening
// a conversation later is instant.

import { MESSAGES_CONNECTION_ERROR } from "@asm/ui/lib/messages-errors";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "expo-router";
import {
  BellOff,
  MessageCircle,
  Plus,
  Search,
  Ticket,
  Users,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Keyboard,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  View,
} from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { resetHeaderScroll } from "@/features/feed/lib/header-visibility";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { UserBadge } from "@/features/home/components/user-badge";
import { createConversation } from "@/features/messages/lib/client";
import type {
  PresenceUser,
  SearchUserResult,
} from "@/features/messages/lib/client";
import {
  CONVERSATION_FILTERS,
  conversationCounts,
  conversationKind,
  conversationLeft,
  unreadConversationCounts,
} from "@/features/messages/lib/conversation-presentation";
import type { ConversationFilter } from "@/features/messages/lib/conversation-presentation";
import { messageDecryptor } from "@/features/messages/lib/decryptor";
import type { DecryptItem } from "@/features/messages/lib/decryptor";
import type { GlobalMessageSearchResult } from "@/features/messages/lib/global-message-search";
import {
  formatArrivalCount,
  formatListTimestamp,
} from "@/features/messages/lib/message-grouping";
import {
  chip3d,
  reelsInput,
  surface3d,
} from "@/features/messages/lib/message-recipes";
import { conversationListStore } from "@/features/messages/state/conversation-list-store";
import type { ConversationRowView } from "@/features/messages/state/conversation-list-store";
import { useMessagesIdentity } from "@/features/messages/state/message-identity";
import { useGlobalMessageSearch } from "@/features/messages/state/use-global-message-search";
import { useMessagePresence } from "@/features/messages/state/use-message-presence";
import { useConversationList } from "@/features/messages/state/use-messages-data";
import { useProfileSearch } from "@/features/messages/state/use-profile-search";
import { useUnreadNotificationCount } from "@/features/notifications/state/use-unread-count";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/layout/list-virtualization";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/layout/scroll-indicator";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { CommunityChatStrip } from "./community-chat-strip";
import { DenAvatar } from "./den-avatar";
import { DenDialog } from "./den-dialog";
import { GlobalMessageSearchResults } from "./global-message-search-results";
import { MessagePresenceIndicator } from "./message-presence-indicator";
import { MessagesErrorState } from "./messages-error-state";
import { MessagesIconButton, PressableRow } from "./messages-primitives";
import { ConversationListSkeleton } from "./messages-skeleton";

export { conversationListStore } from "@/features/messages/state/conversation-list-store";

export function ConversationListScreen({
  dmUserId,
  onDmHandled,
  onOpen,
  onOpenMessage,
}: {
  // `?dm=<userId>` from a profile's Message button: create-or-open that DM once
  // the identity is ready, then the route clears the param.
  dmUserId?: string | null;
  onDmHandled?: () => void;
  onOpen: (conversationId: string) => void;
  onOpenMessage?: (conversationId: string, messageId: string) => void;
}) {
  const { theme, isDark } = useAppTheme();
  const { user } = useSessionContext();
  const unreadNotifications = useUnreadNotificationCount(
    user?.id ?? null,
    Boolean(user)
  );
  useFocusEffect(
    useCallback(() => {
      resetHeaderScroll();
    }, [])
  );
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [filter, setFilter] = useState<ConversationFilter>("ALL");
  const [denDialog, setDenDialog] = useState<"create" | "join" | null>(null);
  const identity = useMessagesIdentity();
  const field = reelsInput(isDark);
  const raised = surface3d(isDark);
  const chip = chip3d(isDark);

  const list = useConversationList();
  const identityFailed =
    identity.status === "error" || identity.status === "locked";
  const messageError = identityFailed
    ? (identity.error ?? MESSAGES_CONNECTION_ERROR)
    : list.error && MESSAGES_CONNECTION_ERROR;
  const retryMessages = () => {
    if (identityFailed) {
      identity.retry();
    }
    list.refresh();
  };
  // One create-or-open flow for every entry point: an online friend, a profile
  // search result, and the `?dm=` deep link. The ref is the lock, so a double tap
  // cannot create two conversations while the first request is in flight.
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const creatingRef = useRef(false);
  const startConversation = useCallback(
    async (recipientId: string): Promise<boolean> => {
      if (creatingRef.current) {
        return false;
      }
      creatingRef.current = true;
      setCreatingId(recipientId);
      let opened = false;
      try {
        const existing = conversationListStore
          .getSnapshot()
          .rows.find(
            (row) =>
              conversationKind(row.conversation) === "DM" &&
              row.peerId === recipientId
          );
        if (existing) {
          onOpen(existing.conversation.id);
        } else {
          const result = await createConversation(recipientId, {
            apiBase: getApiBaseUrl(),
            cookie: await authClient.getCookie(),
          });
          list.refresh();
          onOpen(result.conversation.id);
        }
        opened = true;
      } catch (error) {
        toast({
          description:
            error instanceof Error && error.message
              ? error.message
              : "Please try again.",
          title: "Couldn't open conversation",
          variant: "destructive",
        });
      }
      creatingRef.current = false;
      setCreatingId(null);
      return opened;
    },
    [list, onOpen]
  );
  const openingPerson = creatingId !== null;
  const handleOnlinePerson = (person: PresenceUser) => {
    void startConversation(person.id);
  };

  // `?dm=` waits for a ready identity (the new conversation needs keys) and is
  // consumed exactly once, whatever the outcome.
  const handledDm = useRef<string | null>(null);
  useEffect(() => {
    if (!dmUserId || identity.status !== "ready") {
      return;
    }
    if (handledDm.current === dmUserId) {
      return;
    }
    handledDm.current = dmUserId;
    onDmHandled?.();
    setQuery("");
    void startConversation(dmUserId);
  }, [dmUserId, identity.status, onDmHandled, startConversation]);

  const searchQuery = query.trim();
  const searching = searchQuery.length > 0;
  const globalSearch = useGlobalMessageSearch({
    conversationType: filter,
    query,
  });
  const profileSearch = useProfileSearch(query);
  const [profilesExpanded, setProfilesExpanded] = useState(false);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const changeQuery = useCallback((value: string) => {
    setProfilesExpanded(false);
    setFocusMessageId(null);
    setQuery(value);
  }, []);
  const handleProfileSelect = useCallback(
    (profile: SearchUserResult) => {
      if (!profile.hasIdentity) {
        toast({
          description: `${profile.displayName} hasn't enabled Messages yet`,
          title: "Can't message",
          variant: "destructive",
        });
        return;
      }
      void (async () => {
        if (await startConversation(profile.id)) {
          changeQuery("");
        }
      })();
    },
    [changeQuery, startConversation]
  );
  const handleSearchSelect = useCallback(
    (result: GlobalMessageSearchResult) => {
      setFocusMessageId(result.hit.id);
      Keyboard.dismiss();
      if (onOpenMessage) {
        onOpenMessage(result.hit.conversationId, result.hit.id);
      } else {
        onOpen(result.hit.conversationId);
      }
    },
    [onOpen, onOpenMessage]
  );
  const handleFailedPageRetry =
    globalSearch.results.length > 0 && globalSearch.hasMore
      ? globalSearch.loadMore
      : globalSearch.retry;
  const handleSearchLoadMore = globalSearch.loadMore;
  const handleSearchRefresh = globalSearch.retry;
  const handleProfileRetry = profileSearch.retry;

  const handleLoadMore = list.loadMore;
  const presence = useMessagePresence();
  const counts = conversationCounts(list.rows.map((row) => row.conversation));
  const unreadCounts = unreadConversationCounts(list.rows);
  const rows = list.rows.filter(
    (row) => filter === "ALL" || conversationKind(row.conversation) === filter
  );

  const presenceById = useMemo(
    () => new Map(presence.map((entry) => [entry.id, entry.status])),
    [presence]
  );

  const decryptItems = useMemo<DecryptItem[]>(
    () =>
      list.rows
        .filter((row) => row.lastMessage !== null)
        .map((row) => ({
          conversationId: row.conversation.id,
          message: {
            ciphertext: row.lastMessage?.ciphertext ?? "",
            id: row.lastMessage?.id ?? row.conversation.id,
            iv: row.lastMessage?.iv ?? "",
            ratchetIndex: row.lastMessage?.ratchetIndex ?? 0,
            senderId: row.lastMessage?.senderId ?? "",
          },
        })),
    [list.rows]
  );

  // The row previews are filled from the decryptor's cache rather than from the
  // store, so a row whose payload lands a moment after the row renders updates in
  // place. Subscribing to the decryptor's version counter is what re-renders the
  // list when that happens.
  useDecryptPreviews(decryptItems);

  const handleRefresh = useCallback(() => {
    list.refresh();
  }, [list]);

  const renderRow = useCallback(
    ({ item }: { item: ConversationRowView }) => (
      <ConversationRow
        onPress={() => onOpen(item.conversation.id)}
        presence={presenceById.get(item.peerId ?? "") ?? "offline"}
        row={item}
      />
    ),
    [onOpen, presenceById]
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader
        unreadCount={unreadNotifications}
        user={user ? { ...user, username: user.username ?? "" } : null}
      />
      {/* Web's `flex min-h-0 flex-1` row: the 64px community strip, then the
          list pane. */}
      <View style={styles.panes}>
        <CommunityChatStrip />
        <View style={styles.listPane}>
          <View style={{ backgroundColor: theme.containerBg }}>
            <View
              style={{
                alignItems: "center",
                flexDirection: "row",
                gap: 8,
                height: 56,
                paddingHorizontal: 10,
                zIndex: 20,
              }}
            >
              {/* Web's `premium-input h-11 rounded-xl pl-9 pr-11 text-base`. */}
              <View
                style={{
                  alignItems: "center",
                  backgroundColor: field.background,
                  borderRadius: 12,
                  boxShadow: field.shadows,
                  flex: 1,
                  flexDirection: "row",
                  gap: 8,
                  height: 44,
                  paddingLeft: 12,
                }}
              >
                <Search size={16} color={theme.dividerText} />
                <TextInput
                  accessibilityLabel="Search profiles and messages"
                  placeholder="Search…"
                  placeholderTextColor={theme.dividerText}
                  value={query}
                  onBlur={() => setSearchFocused(false)}
                  onChangeText={changeQuery}
                  onFocus={() => setSearchFocused(true)}
                  autoCapitalize="none"
                  maxLength={512}
                  returnKeyType="search"
                  style={{
                    color: theme.inputText,
                    flex: 1,
                    fontFamily: "SofiaProReg",
                    fontSize: 16,
                    minWidth: 0,
                    padding: 0,
                    paddingRight: query ? 0 : 12,
                  }}
                />
                {query ? (
                  <Pressable
                    accessibilityLabel="Clear search"
                    accessibilityRole="button"
                    onPress={() => changeQuery("")}
                    style={{
                      alignItems: "center",
                      height: 44,
                      justifyContent: "center",
                      width: 44,
                    }}
                  >
                    <X color={theme.dividerText} size={16} />
                  </Pressable>
                ) : null}
              </View>
              {/* Web collapses both den keys while the search is in use. */}
              {searchFocused || query ? null : (
                <>
                  <MessagesIconButton
                    icon={Ticket}
                    iconSize={16}
                    label="Join a den"
                    size={44}
                    onPress={() => setDenDialog("join")}
                  />
                  <MessagesIconButton
                    icon={Plus}
                    iconSize={16}
                    label="New den"
                    size={44}
                    onPress={() => setDenDialog("create")}
                  />
                </>
              )}
            </View>
            {!query &&
            presence.some(
              (person) => person.status === "online" && person.isFollowing
            ) ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  gap: 12,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                }}
              >
                {presence
                  .filter(
                    (person) => person.status === "online" && person.isFollowing
                  )
                  .map((person) => (
                    <Pressable
                      key={person.id}
                      accessibilityLabel={`Message ${person.displayName} (@${person.username}), online`}
                      accessibilityState={{
                        busy: creatingId === person.id,
                        disabled: openingPerson,
                      }}
                      disabled={openingPerson}
                      onPress={() => handleOnlinePerson(person)}
                      style={{ opacity: openingPerson ? 0.6 : 1 }}
                    >
                      <UserAvatar
                        size={48}
                        url={person.avatarUrl}
                        userId={person.id}
                      />
                      <MessagePresenceIndicator
                        status="online"
                        testID="online-friend-presence"
                      />
                    </Pressable>
                  ))}
              </ScrollView>
            ) : null}
            <View
              accessibilityLabel={
                searching ? "Filter message results" : "Filter conversations"
              }
              accessibilityRole="tablist"
              style={{
                backgroundColor: raised.background,
                borderRadius: 16,
                boxShadow: raised.shadows,
                flexDirection: "row",
                gap: 4,
                marginHorizontal: 10,
                marginVertical: 4,
                padding: 4,
              }}
            >
              {CONVERSATION_FILTERS.map((option) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityLabel={
                    searching
                      ? `${option.label} message results`
                      : `${option.label}, ${counts[option.key]} conversations${unreadCounts[option.key] > 0 ? ", unread messages" : ""}`
                  }
                  accessibilityState={{ selected: filter === option.key }}
                  key={option.key}
                  onPress={() => {
                    setFocusMessageId(null);
                    setFilter(option.key);
                  }}
                  style={{
                    alignItems: "center",
                    backgroundColor:
                      filter === option.key ? chip.background : "transparent",
                    borderRadius: 12,
                    boxShadow: filter === option.key ? chip.shadows : undefined,
                    flex: 1,
                    flexDirection: "row",
                    gap: 8,
                    justifyContent: "center",
                    minHeight: 44,
                  }}
                >
                  <Text
                    style={{
                      color: theme.inputText,
                      fontFamily:
                        filter === option.key ? "SofiaProBold" : "SofiaProMed",
                      fontSize: 12,
                    }}
                  >
                    {option.label}
                  </Text>
                  {/* Web hides the counts while a search is showing results. */}
                  {query.trim() ? null : (
                    <View
                      style={{
                        backgroundColor: chip.background,
                        borderRadius: 999,
                        boxShadow: chip.shadows,
                        minWidth: 20,
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                      }}
                    >
                      <Text
                        style={{
                          color: theme.inputText,
                          fontFamily: "SofiaProMed",
                          fontSize: 10,
                          textAlign: "center",
                        }}
                      >
                        {counts[option.key]}
                      </Text>
                    </View>
                  )}
                  {!query.trim() && unreadCounts[option.key] > 0 ? (
                    // `size-1.5 top-1.5 right-1.5` dot, #ffb45c to #e65500 with a glow.
                    <LinearGradient
                      colors={["#ffb45c", "#e65500"]}
                      end={{ x: 0.5, y: 1 }}
                      pointerEvents="none"
                      start={{ x: 0.5, y: 0 }}
                      style={styles.tabUnreadDot}
                    />
                  ) : null}
                </Pressable>
              ))}
            </View>
          </View>
          {searching ? (
            <View style={styles.searchBody}>
              {[...searchQuery].length > 256 ? (
                <Text
                  style={[styles.searchLimit, { color: theme.dividerText }]}
                >
                  Use 256 characters or fewer to search.
                </Text>
              ) : (
                <GlobalMessageSearchResults
                  coverageComplete={globalSearch.coverageComplete}
                  coveragePaused={globalSearch.coveragePaused}
                  creatingProfileId={creatingId}
                  error={globalSearch.error}
                  focusMessageId={focusMessageId}
                  hasMore={globalSearch.hasMore}
                  loading={globalSearch.loading}
                  loadingMore={globalSearch.loadingMore}
                  messageQueryValid={globalSearch.messageQueryValid}
                  myUserId={user?.id ?? ""}
                  onLoadMore={handleSearchLoadMore}
                  onProfileRetry={handleProfileRetry}
                  onProfileSelect={handleProfileSelect}
                  onProfileToggleExpanded={() =>
                    setProfilesExpanded((expanded) => !expanded)
                  }
                  onRefresh={handleSearchRefresh}
                  onRetry={handleFailedPageRetry}
                  onSelect={handleSearchSelect}
                  profileError={profileSearch.error}
                  profileExpanded={profilesExpanded}
                  profileLoading={profileSearch.loading}
                  profileRetryAt={profileSearch.retryAt}
                  profiles={profileSearch.profiles}
                  query={query}
                  results={globalSearch.results}
                  retryAt={globalSearch.retryAt}
                />
              )}
            </View>
          ) : null}
          <View style={searching ? styles.hidden : styles.listBody}>
            {messageError && list.rows.length > 0 ? (
              <MessagesErrorState
                compact
                message={messageError}
                onRetry={retryMessages}
              />
            ) : null}
            {messageError && list.rows.length === 0 ? (
              <MessagesErrorState
                message={messageError}
                onRetry={retryMessages}
              />
            ) : null}
            {!messageError &&
            (identity.status === "loading" || list.loading) &&
            list.rows.length === 0 ? (
              <ConversationListSkeleton />
            ) : null}
            {(!messageError || list.rows.length > 0) &&
            ((identity.status !== "loading" && !list.loading) ||
              list.rows.length > 0) ? (
              <FlatList
                contentContainerStyle={styles.listContent}
                data={rows}
                onEndReached={handleLoadMore}
                onEndReachedThreshold={0.5}
                ListFooterComponent={
                  list.loadingMore ? <ConversationListSkeleton /> : undefined
                }
                ListEmptyComponent={
                  messageError ? undefined : (
                    <View
                      style={{
                        alignItems: "center",
                        gap: 8,
                        paddingHorizontal: 24,
                        paddingVertical: 40,
                      }}
                    >
                      {/* No conversations at all is "search for somebody"; an
                      empty filter is "you are on the wrong tab". */}
                      {list.rows.length === 0 ? (
                        <MessageCircle size={24} color={theme.dividerText} />
                      ) : (
                        <Users size={24} color={theme.dividerText} />
                      )}
                      <Text
                        style={{
                          color: theme.dividerText,
                          fontFamily: "SofiaProReg",
                          fontSize: 12,
                          textAlign: "center",
                        }}
                      >
                        {list.rows.length === 0
                          ? "No conversations yet. Search for someone you follow to start one, or make a den for a group."
                          : `No ${filter === "DM" ? "DMs" : "dens"} yet.`}
                      </Text>
                    </View>
                  )
                }
                keyExtractor={(row) => row.conversation.id}
                refreshControl={
                  <RefreshControl
                    onRefresh={handleRefresh}
                    refreshing={list.refreshing}
                    tintColor={theme.dividerText}
                  />
                }
                renderItem={renderRow}
                showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
                {...LIST_VIRTUALIZATION_PROPS}
              />
            ) : null}
          </View>
        </View>
      </View>
      <MobileBottomNav />
      {denDialog ? (
        <DenDialog
          mode={denDialog}
          onClose={() => setDenDialog(null)}
          onOpen={(id) => {
            setDenDialog(null);
            list.refresh();
            onOpen(id);
          }}
        />
      ) : null}
    </View>
  );
}

// A row with no messages at all says so; a row whose last message has not
// decrypted yet says nothing rather than flashing "No messages yet".
// Web's fallbacks: a departed den states the reader's own position, and a muted
// row with nothing to preview says it is muted.
function previewTextFor(
  row: ConversationRowView,
  decrypted: boolean,
  left: boolean
): string {
  if (left) {
    return "You left this den";
  }
  const preview = decrypted ? row.preview : "";
  if (preview.length > 0) {
    return preview;
  }
  if (row.muted) {
    return "Muted";
  }
  if (!decrypted) {
    return "";
  }
  return row.lastMessage ? "" : "No messages yet";
}

// text-primary: hsl(22.93 92.59% 52.35%) in both themes.
const PRIMARY = "#f66b15";

// Unread rows are louder than read ones: a heavier face and brighter ink. Two
// steps rather than a ramp, so a row never reads as "half-read".
function previewTone(unread: boolean, isDark: boolean, read: string) {
  if (!unread) {
    return { color: read, fontFamily: "SofiaProReg" } as const;
  }
  return {
    color: isDark ? "#d0d0d0" : "#4a4a4a",
    fontFamily: "SofiaProMed",
  } as const;
}

function ConversationRow({
  onPress,
  presence,
  row,
}: {
  onPress: () => void;
  presence: "idle" | "offline" | "online";
  row: ConversationRowView;
}) {
  const { isDark, theme } = useAppTheme();
  const unread = row.unreadCount > 0;
  const { payload } = row;
  const isDen = conversationKind(row.conversation) === "DEN";
  const left = conversationLeft(row.conversation, row.mineUserId);
  const peer = row.conversation.members.find(
    (member) => member.userId === row.peerId
  )?.user;
  const chip = chip3d(isDark);
  return (
    <PressableRow onPress={onPress} style={styles.row}>
      <View style={styles.avatarWrap}>
        {/* Web dims every inactive row's avatar to 65%. */}
        <View style={styles.avatarDim}>
          {isDen ? (
            <DenAvatar conversation={row.conversation} />
          ) : (
            <UserAvatar
              size={40}
              url={row.avatarUrl}
              userId={row.peerId}
              username={row.peerUsername}
            />
          )}
        </View>
        {isDen || presence === "offline" ? null : (
          <MessagePresenceIndicator
            status={presence}
            testID="conversation-list-presence"
          />
        )}
        {row.muted ? (
          <View
            accessibilityLabel="Muted"
            style={[styles.mutedBadge, { backgroundColor: theme.containerBg }]}
          >
            <BellOff color={theme.dividerText} size={10} />
          </View>
        ) : null}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text
            numberOfLines={1}
            style={[
              styles.rowName,
              {
                color: isDark ? "#eeeeee" : "#202020",
                fontFamily: unread ? "SofiaProBold" : "SofiaProMed",
              },
            ]}
          >
            {row.displayName}
          </Text>
          {left ? (
            <View
              style={[
                styles.leftChip,
                { backgroundColor: chip.background, boxShadow: chip.shadows },
              ]}
            >
              <Text style={[styles.leftChipText, { color: theme.dividerText }]}>
                Left
              </Text>
            </View>
          ) : null}
          {isDen ? null : (
            <UserBadge
              badge={peer?.badge}
              badges={peer?.badges}
              communityRoles={peer?.communityMemberships}
            />
          )}
          <View style={styles.rowMeta}>
            <Text
              style={[
                styles.rowTime,
                unread
                  ? { color: PRIMARY, fontFamily: "SofiaProBold" }
                  : { color: theme.dividerText },
              ]}
            >
              {row.lastMessage
                ? formatListTimestamp(row.lastMessage.createdAt)
                : ""}
            </Text>
          </View>
        </View>
        <View style={styles.rowBottom}>
          <Text
            numberOfLines={1}
            style={[
              styles.rowPreview,
              previewTone(unread, isDark, theme.dividerText),
            ]}
          >
            {previewTextFor(row, payload !== undefined, left)}
          </Text>
          {unread ? (
            <View style={[styles.unreadPill, { backgroundColor: PRIMARY }]}>
              <Text style={styles.unreadPillText}>
                {formatArrivalCount(row.unreadCount)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </PressableRow>
  );
}

// Keeps the decryptor subscribed for the visible rows' last messages, and pushes
// each decrypted payload back into the row's preview.
function useDecryptPreviews(items: DecryptItem[]) {
  const { getBaseKeys, status } = useMessagesIdentity();
  useEffect(() => {
    if (status !== "ready") {
      return;
    }
    const apply = () => {
      const payloads = new Map(
        items.map((item) => {
          const entry = messageDecryptor.get(item.message.id);
          return [
            item.message.id,
            typeof entry === "object" ? entry : undefined,
          ] as const;
        })
      );
      conversationListStore.applyPreview(payloads);
    };
    const unsubscribe = messageDecryptor.subscribe(apply);
    messageDecryptor.request(items, { getBaseKeys });
    apply();
    return unsubscribe;
  }, [getBaseKeys, items, status]);
}

const styles = StyleSheet.create({
  avatarDim: { opacity: 0.65 },
  avatarWrap: {
    height: 40,
    width: 40,
  },
  // The list stays mounted under a search so its scroll position survives.
  hidden: { display: "none" },
  // `chip-3d rounded-full px-1.5 py-0.5 text-[10px] font-medium`.
  leftChip: {
    borderRadius: 9999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  leftChipText: {
    fontFamily: "SofiaProMed",
    fontSize: 10,
  },
  listBody: { flex: 1 },
  listContent: {
    paddingBottom: 120,
    paddingHorizontal: 8,
  },
  listPane: { flex: 1, minWidth: 0 },
  // `size-4 bg-background rounded-full -bottom-0.5 -left-0.5` holding a 10px BellOff.
  mutedBadge: {
    alignItems: "center",
    borderRadius: 8,
    bottom: -2,
    height: 16,
    justifyContent: "center",
    left: -2,
    position: "absolute",
    width: 16,
  },
  panes: { flex: 1, flexDirection: "row", minHeight: 0 },
  root: {
    flex: 1,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    height: 64,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rowBody: {
    flex: 1,
    gap: 3,
  },
  rowBottom: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  rowMeta: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  rowName: {
    flex: 1,
    fontSize: 14,
  },
  rowPreview: {
    flex: 1,
    fontSize: 12,
  },
  rowTime: {
    fontFamily: "SofiaProReg",
    fontSize: 10,
    fontVariant: ["tabular-nums"],
  },
  rowTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  // Web's `p-2` list container around the unified results.
  searchBody: { flex: 1, paddingHorizontal: 8 },
  searchLimit: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  tabUnreadDot: {
    borderRadius: 3,
    boxShadow: "0 0 6px rgba(255, 149, 0, 0.5)",
    height: 6,
    position: "absolute",
    right: 6,
    top: 6,
    width: 6,
  },
  // `bg-primary h-4 min-w-4 rounded-full px-1 text-[10px] font-semibold`.
  unreadPill: {
    alignItems: "center",
    borderRadius: 9999,
    justifyContent: "center",
    minHeight: 16,
    minWidth: 16,
    paddingHorizontal: 4,
  },
  unreadPillText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 10,
    fontWeight: "normal",
  },
});
