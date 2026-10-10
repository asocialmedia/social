// The conversation list: who each conversation is with, what was last said, when,
// and how many are unread.
//
// Ported from apps/web/src/components/messages/conversation-list.tsx and
// conversation-list-item.tsx. The preview line is the interesting part: the server
// stores only ciphertext, so the one-line description of a chat the reader has not
// opened is derived here, on the client, from the decrypted payload. Each row's
// last message is decrypted through the same scheduler the thread uses, so opening
// a conversation later is instant.

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { useSessionContext } from "@/features/auth/state/session";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { messageDecryptor } from "@/features/messages/lib/decryptor";
import type { DecryptItem } from "@/features/messages/lib/decryptor";
import {
  formatArrivalCount,
  formatListTimestamp,
} from "@/features/messages/lib/message-grouping";
import { conversationListStore } from "@/features/messages/state/conversation-list-store";
import type { ConversationRowView } from "@/features/messages/state/conversation-list-store";
import { useMessagesIdentity } from "@/features/messages/state/message-identity";
import { useMessagePresence } from "@/features/messages/state/use-message-presence";
import { useConversationList } from "@/features/messages/state/use-messages-data";
import { useMessagesForeground } from "@/features/messages/state/use-messages-foreground";
import { useUnreadNotificationCount } from "@/features/notifications/state/use-unread-count";
import { haptic } from "@/lib/haptics";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/list-virtualization";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { useAppTheme } from "@/theme";

import { MessagePeoplePanel } from "./message-people-panel";
import { MutedGlyph, PressableRow } from "./messages-primitives";

export { conversationListStore } from "@/features/messages/state/conversation-list-store";

export function ConversationListScreen({
  onOpen,
}: {
  onOpen: (conversationId: string) => void;
}) {
  const { theme } = useAppTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const { user } = useSessionContext();
  const userId = user?.id ?? null;
  const list = useConversationList();
  const foreground = useMessagesForeground();
  const unreadCount = useUnreadNotificationCount(userId, foreground);
  const presence = useMessagePresence();

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
        onSearchPress={() => {
          haptic();
          setSearchOpen((open) => !open);
        }}
        searchLabel="Search people"
        searchOpen={searchOpen}
        unreadCount={unreadCount}
        user={
          user
            ? {
                avatarUrl: user.image ?? null,
                id: user.id,
                username: user.username ?? "",
              }
            : null
        }
      />
      <View style={{ flex: 1 }}>
        {searchOpen ? (
          <View
            style={{
              left: 8,
              position: "absolute",
              right: 8,
              top: 8,
              zIndex: 10,
            }}
          >
            <MessagePeoplePanel
              mode="search"
              onClose={() => setSearchOpen(false)}
            />
          </View>
        ) : null}
        {list.error ? (
          <PressableRow onPress={handleRefresh} style={{ padding: 16 }}>
            <Text
              style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}
            >
              Couldn't update Messages. Tap to retry.
            </Text>
          </PressableRow>
        ) : null}
        {list.loading && list.rows.length === 0 ? (
          <ConversationListSkeleton />
        ) : (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={list.rows}
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
        )}
      </View>
      <MobileBottomNav />
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
        <UserAvatar
          size={40}
          url={row.avatarUrl}
          userId={row.peerId}
          username={row.peerUsername}
        />
        {presence === "offline" ? null : (
          <View
            style={[
              styles.presence,
              {
                backgroundColor: presence === "online" ? "#22c55e" : "#f59e0b",
              },
            ]}
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
          <View style={styles.rowMeta}>
            {row.muted ? <MutedGlyph /> : null}
            <Text style={[styles.rowTime, { color: theme.dividerText }]}>
              {formatListTimestamp(row.conversation.updatedAt)}
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

function ConversationListSkeleton() {
  const { theme } = useAppTheme();
  return (
    <View style={styles.skeleton}>
      {Array.from({ length: 8 }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <View
            style={[
              styles.skeletonAvatar,
              { backgroundColor: theme.dividerLine },
            ]}
          />
          <View style={styles.skeletonBody}>
            <View
              style={[
                styles.skeletonLine,
                { backgroundColor: theme.dividerLine, width: "45%" },
              ]}
            />
            <View
              style={[
                styles.skeletonLine,
                { backgroundColor: theme.dividerLine, width: "75%" },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
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
  presence: {
    borderColor: "#00000066",
    borderRadius: 9999,
    borderWidth: 2,
    bottom: 0,
    height: 13,
    position: "absolute",
    right: 0,
    width: 13,
  },
  root: {
    flex: 1,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
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
    fontSize: 15,
  },
  rowPreview: {
    flex: 1,
    fontSize: 13,
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
  skeleton: {
    gap: 18,
    padding: 16,
  },
  skeletonAvatar: {
    borderRadius: 14,
    height: 40,
    width: 40,
  },
  skeletonBody: {
    flex: 1,
    gap: 8,
  },
  skeletonLine: {
    borderRadius: 4,
    height: 12,
  },
  skeletonRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
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
