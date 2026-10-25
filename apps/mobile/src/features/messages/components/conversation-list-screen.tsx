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
import { useFocusEffect } from "expo-router";
import { Plus, Search, Ticket, X, MessageCircle } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  View,
} from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { resetHeaderScroll } from "@/features/feed/lib/header-visibility";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { UserBadge } from "@/features/home/components/user-badge";
import { createConversation } from "@/features/messages/lib/client";
import type { PresenceUser } from "@/features/messages/lib/client";
import {
  CONVERSATION_FILTERS,
  conversationCounts,
  conversationKind,
  conversationLeft,
} from "@/features/messages/lib/conversation-presentation";
import type { ConversationFilter } from "@/features/messages/lib/conversation-presentation";
import { messageDecryptor } from "@/features/messages/lib/decryptor";
import type { DecryptItem } from "@/features/messages/lib/decryptor";
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
import { useMessagePresence } from "@/features/messages/state/use-message-presence";
import { useConversationList } from "@/features/messages/state/use-messages-data";
import { useUnreadNotificationCount } from "@/features/notifications/state/use-unread-count";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/layout/list-virtualization";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/layout/scroll-indicator";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { DenAvatar } from "./den-avatar";
import { DenDialog } from "./den-dialog";
import { MessagePeoplePanel } from "./message-people-panel";
import { MessagePresenceIndicator } from "./message-presence-indicator";
import { MessagesErrorState } from "./messages-error-state";
import {
  MessagesIconButton,
  MutedGlyph,
  PressableRow,
} from "./messages-primitives";
import { ConversationListSkeleton } from "./messages-skeleton";

export { conversationListStore } from "@/features/messages/state/conversation-list-store";

export function ConversationListScreen({
  onOpen,
}: {
  onOpen: (conversationId: string) => void;
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
  const [openingPerson, setOpeningPerson] = useState(false);
  const handleOnlinePerson = async (person: PresenceUser) => {
    if (openingPerson) {
      return;
    }
    setOpeningPerson(true);
    try {
      const existing = list.rows.find(
        (row) =>
          conversationKind(row.conversation) === "DM" &&
          row.peerId === person.id
      );
      if (existing) {
        onOpen(existing.conversation.id);
      } else {
        const result = await createConversation(person.id, {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        });
        list.refresh();
        onOpen(result.conversation.id);
      }
    } catch {
      conversationListStore.setSnapshot({
        error: "Couldn't open this conversation. Try again.",
      });
    }
    setOpeningPerson(false);
  };

  const handleLoadMore = list.loadMore;
  const presence = useMessagePresence();
  const counts = conversationCounts(list.rows.map((row) => row.conversation));
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
          <View
            style={{
              alignItems: "center",
              backgroundColor: field.background,
              borderRadius: 12,
              boxShadow: field.shadows,
              flex: 1,
              flexDirection: "row",
              gap: 8,
              height: 36,
              paddingHorizontal: 12,
            }}
          >
            <Search size={16} color={theme.dividerText} />
            <TextInput
              accessibilityLabel="Search people you follow"
              placeholder="Search people you follow…"
              placeholderTextColor={theme.dividerText}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              style={{
                color: theme.inputText,
                flex: 1,
                fontFamily: "SofiaProReg",
                fontSize: 14,
                minWidth: 0,
                padding: 0,
              }}
            />
            {query ? (
              <MessagesIconButton
                icon={X}
                label="Clear search"
                size={24}
                onPress={() => setQuery("")}
              />
            ) : null}
          </View>
          <MessagesIconButton
            icon={Ticket}
            label="Join a den"
            size={36}
            onPress={() => setDenDialog("join")}
          />
          <MessagesIconButton
            icon={Plus}
            label="New den"
            size={36}
            onPress={() => setDenDialog("create")}
          />
          {query.trim() ? (
            <View
              style={{
                left: 10,
                position: "absolute",
                right: 10,
                top: 56,
                zIndex: 30,
              }}
            >
              <MessagePeoplePanel
                mode="search"
                searchQuery={query}
                onClose={() => {
                  setQuery("");
                  list.refresh();
                }}
              />
            </View>
          ) : null}
        </View>
        {presence.some(
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
                  accessibilityLabel={`Message ${person.displayName}, online`}
                  disabled={openingPerson}
                  onPress={() => {
                    void handleOnlinePerson(person);
                  }}
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
              accessibilityLabel={`${option.label}, ${counts[option.key]} conversations`}
              accessibilityState={{ selected: filter === option.key }}
              key={option.key}
              onPress={() => setFilter(option.key)}
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
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ flex: 1 }}>
        {messageError && list.rows.length > 0 ? (
          <MessagesErrorState
            compact
            message={messageError}
            onRetry={retryMessages}
          />
        ) : null}
        {messageError && list.rows.length === 0 ? (
          <MessagesErrorState message={messageError} onRetry={retryMessages} />
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
                  <MessageCircle size={24} color={theme.dividerText} />
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
function previewTextFor(row: ConversationRowView, decrypted: boolean): string {
  if (!decrypted) {
    return "";
  }
  if (row.preview.length > 0) {
    return row.preview;
  }
  return row.lastMessage ? "" : "No messages yet";
}

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
  return (
    <PressableRow onPress={onPress} style={styles.row}>
      <View style={styles.avatarWrap}>
        {conversationKind(row.conversation) === "DEN" ? (
          <DenAvatar conversation={row.conversation} />
        ) : (
          <UserAvatar
            size={40}
            url={row.avatarUrl}
            userId={row.peerId}
            username={row.peerUsername}
          />
        )}
        {conversationKind(row.conversation) === "DEN" ? null : (
          <MessagePresenceIndicator
            status={presence}
            testID="conversation-list-presence"
          />
        )}
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
          {conversationKind(row.conversation) === "DM" ? (
            <UserBadge
              badge={
                row.conversation.members.find(
                  (member) => member.userId === row.peerId
                )?.user.badge
              }
              badges={
                row.conversation.members.find(
                  (member) => member.userId === row.peerId
                )?.user.badges
              }
            />
          ) : null}
          {conversationLeft(row.conversation, row.mineUserId) ? (
            <Text style={{ color: theme.dividerText, fontSize: 10 }}>Left</Text>
          ) : null}
          <View style={styles.rowMeta}>
            {row.muted ? <MutedGlyph /> : null}
            <Text style={[styles.rowTime, { color: theme.dividerText }]}>
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
            {previewTextFor(row, payload !== undefined)}
          </Text>
          {unread ? (
            <View
              style={[
                styles.unreadPill,
                { backgroundColor: isDark ? "#e65500" : "#ff9500" },
              ]}
            >
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
  avatarWrap: {
    height: 40,
    width: 40,
  },
  listContent: {
    paddingBottom: 120,
    paddingHorizontal: 8,
  },
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
    fontSize: 11,
  },
  rowTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  unreadPill: {
    alignItems: "center",
    borderRadius: 9999,
    justifyContent: "center",
    minHeight: 18,
    minWidth: 18,
    paddingHorizontal: 5,
  },
  unreadPillText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 10,
    fontWeight: "normal",
  },
});
