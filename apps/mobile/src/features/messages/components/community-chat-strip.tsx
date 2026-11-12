// The 64px column of joined communities on the left of the messages list.
//
// Ported from apps/web/src/components/messages/community-chat-strip.tsx. Touch
// has no hover, so web's touch branch is the reference: a tap opens a preview
// card with an explicit "Open community chat" action rather than navigating.
import { useRouter } from "expo-router";
import { MessageCircle, RotateCw, Users } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { ViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { CommunityAvatar } from "@/features/communities/components/community-avatar";
import { CommunityCard } from "@/features/communities/components/community-card";
import { communityChatUiEnabled } from "@/features/communities/lib/community-chat-features";
import { fetchCommunityChatInbox } from "@/features/messages/lib/client";
import type { CommunityChatInboxEntry } from "@/features/messages/lib/client";
import { panel3d } from "@/features/messages/lib/message-recipes";
import { useMessagesForeground } from "@/features/messages/state/use-messages-foreground";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { MessagesGrayButton } from "./messages-gray-button";

// Web's query: refetch every 15s while visible, treat 10s as fresh.
const INBOX_POLL_MS = 15_000;
const PRIMARY = "#f66b15";

type InboxState =
  | { status: "pending" }
  | { status: "error" }
  | { communities: CommunityChatInboxEntry[]; status: "success" };

// Survives remounts so returning to the list does not flash skeletons.
let cachedInbox: {
  at: number;
  communities: CommunityChatInboxEntry[];
  userId: string;
} | null = null;

function useCommunityChatInbox(userId: string | null, enabled: boolean) {
  const foreground = useMessagesForeground();
  const [state, setState] = useState<InboxState>(() =>
    cachedInbox && cachedInbox.userId === userId
      ? { communities: cachedInbox.communities, status: "success" }
      : { status: "pending" }
  );
  const [fetching, setFetching] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled || !userId || !foreground) {
      return;
    }
    let cancelled = false;
    const load = async (force: boolean) => {
      if (
        !force &&
        cachedInbox?.userId === userId &&
        Date.now() - cachedInbox.at < 10_000
      ) {
        return;
      }
      setFetching(true);
      try {
        const result = await fetchCommunityChatInbox({
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        });
        if (!cancelled) {
          cachedInbox = {
            at: Date.now(),
            communities: result.communities,
            userId,
          };
          setState({ communities: result.communities, status: "success" });
        }
      } catch {
        // A failed poll keeps what is on screen; only a first load shows retry.
        if (!cancelled) {
          setState((current) =>
            current.status === "success" ? current : { status: "error" }
          );
        }
      }
      if (!cancelled) {
        setFetching(false);
      }
    };
    void load(nonce > 0);
    const timer = setInterval(() => {
      void load(true);
    }, INBOX_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, foreground, nonce, userId]);
  const refetch = useCallback(() => setNonce((value) => value + 1), []);
  return { fetching, refetch, state };
}

export function CommunityChatStrip() {
  const { theme, isDark } = useAppTheme();
  const { user } = useSessionContext();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const userId = user?.id ?? null;
  const { fetching, refetch, state } = useCommunityChatInbox(
    userId,
    communityChatUiEnabled
  );
  if (!communityChatUiEnabled || !userId) {
    return null;
  }
  const muted = isDark ? "#262626" : "#e5e5e5";
  let content: ReactNode;
  if (state.status === "pending") {
    content = (
      <View accessibilityLabel="Loading your communities" style={styles.stack}>
        {[0, 1, 2].map((id) => (
          <View
            key={id}
            style={[styles.skeleton, { backgroundColor: muted }]}
          />
        ))}
      </View>
    );
  } else if (state.status === "error") {
    content = (
      <Pressable
        accessibilityLabel="Couldn't load community chats. Retry"
        accessibilityRole="button"
        disabled={fetching}
        onPress={refetch}
        style={({ pressed }) => [
          styles.trigger,
          pressed && { backgroundColor: `${muted}b3` },
        ]}
      >
        <RotateCw color={theme.dividerText} size={20} />
      </Pressable>
    );
  } else if (state.communities.length === 0) {
    content = (
      <Pressable
        accessibilityLabel="No joined communities. Browse communities"
        accessibilityRole="link"
        onPress={() => router.push("/communities")}
        style={({ pressed }) => [
          styles.trigger,
          pressed && { backgroundColor: `${muted}b3` },
        ]}
      >
        <Users color={theme.dividerText} size={20} />
      </Pressable>
    );
  } else {
    content = state.communities.map((entry) => (
      <CommunityChatShortcut entry={entry} key={entry.community.id} />
    ));
  }
  return (
    <View
      accessibilityLabel="Community chats"
      style={[
        styles.strip,
        {
          backgroundColor: theme.containerBg,
          borderRightColor: theme.dividerLine,
        },
      ]}
    >
      <ScrollView
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: 96 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {content}
      </ScrollView>
    </View>
  );
}

function CommunityChatShortcut({ entry }: { entry: CommunityChatInboxEntry }) {
  const { isDark, theme } = useAppTheme();
  const router = useRouter();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const triggerRef = useRef<ViewInstance>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const { community, hasUnread } = entry;
  const muted = isDark ? "#262626" : "#e5e5e5";
  const panel = panel3d(isDark);
  // `w-[min(20rem,calc(100vw-5rem))]`, `max-h-[calc(100dvh-1.5rem)]`.
  const previewWidth = Math.min(320, width - 80);
  const maxPreviewHeight = height - 24 - insets.top - insets.bottom;
  const open = () => {
    triggerRef.current?.measureInWindow((x, y, triggerWidth) => {
      // side="right" sideOffset={8} align="start" collisionPadding={12}.
      setAnchor({
        x: Math.min(x + triggerWidth + 8, width - previewWidth - 12),
        y: Math.max(
          12 + insets.top,
          Math.min(y, height - maxPreviewHeight - 12 - insets.bottom)
        ),
      });
    });
  };
  const close = () => setAnchor(null);
  const chatHref = `/a/${community.slug}/chat` as const;
  return (
    <>
      <Pressable
        accessibilityLabel={`${community.name}${hasUnread ? ", unread messages" : ""}`}
        accessibilityRole="button"
        onPress={open}
        ref={triggerRef}
        style={({ pressed }) => [
          styles.trigger,
          pressed && { backgroundColor: `${muted}b3` },
        ]}
      >
        <CommunityAvatar community={community} size={40} />
        {hasUnread ? (
          <View
            style={[styles.unreadDot, { borderColor: theme.containerBg }]}
          />
        ) : null}
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={close}
        statusBarTranslucent
        transparent
        visible={anchor !== null}
      >
        <Pressable
          accessibilityLabel="Close preview"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        {anchor ? (
          <View
            accessibilityLabel={`${community.name} community preview`}
            style={[
              styles.preview,
              {
                backgroundColor: panel.background,
                borderColor: panel.border,
                boxShadow: panel.shadows,
                left: anchor.x,
                maxHeight: maxPreviewHeight,
                top: anchor.y,
                width: previewWidth,
              },
            ]}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              bounces={false}
            >
              <CommunityCard
                community={community}
                onPress={() => {
                  close();
                  router.push(`/a/${community.slug}`);
                }}
                width={previewWidth - 2}
              />
            </ScrollView>
            <View
              style={[
                styles.previewFooter,
                {
                  backgroundColor: panel.background,
                  borderTopColor: theme.dividerLine,
                },
              ]}
            >
              <MessagesGrayButton
                label="Open community chat"
                onPress={() => {
                  close();
                  router.push(chatHref);
                }}
                style={styles.openChat}
              >
                <MessageCircle
                  color={isDark ? "#ffffff" : "#1f2430"}
                  size={16}
                />
              </MessagesGrayButton>
              {hasUnread ? (
                <Text style={[styles.unreadNote, { color: theme.dividerText }]}>
                  Unread messages
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  openChat: { width: "100%" },
  preview: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    position: "absolute",
  },
  // `border-t p-3`, sticky under the card.
  previewFooter: { borderTopWidth: 1, padding: 12 },
  // `pt-3 gap-2 items-center`.
  scroll: { alignItems: "center", gap: 8, paddingTop: 12 },
  skeleton: { borderRadius: 12, height: 44, width: 44 },
  stack: { gap: 8 },
  // `w-16 border-r`.
  strip: { borderRightWidth: 1, width: 64 },
  // `relative size-11 rounded-xl`.
  trigger: {
    alignItems: "center",
    borderRadius: 12,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  // `bg-primary ring-background absolute top-0.5 right-0.5 size-2.5 ring-2`.
  unreadDot: {
    backgroundColor: PRIMARY,
    borderRadius: 7,
    borderWidth: 2,
    height: 14,
    position: "absolute",
    right: 0,
    top: 0,
    width: 14,
  },
  unreadNote: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    marginTop: 8,
    textAlign: "center",
  },
});
