import type {
  CommunityChatRoom,
  CommunityChatThreadSummary,
} from "@asm/messages";
// oxlint-disable react/todo -- Requests retain visible loading and retry states in the drawer.
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { FileText, LockKeyhole, MessageCircle, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  useWindowDimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusActionButton } from "@/components/feedback/status-action-button";
import { ZephLoader } from "@/components/feedback/zeph-loader";
import { authClient } from "@/features/auth/lib/auth-client";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import { getApiBaseUrl } from "@/lib/network/api-env";
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
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const [closing, setClosing] = useState(false);
  const close = () => setClosing(true);
  const reduceMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  // oxlint-disable-next-line react/hook-use-state -- A stable native animation value owns the entrance.
  const [entrance] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = Animated.timing(entrance, {
      duration: reduceMotion ? 100 : 240,
      easing: closing ? Easing.in(Easing.cubic) : Easing.out(Easing.cubic),
      isInteraction: false,
      toValue: closing ? 0 : 1,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && closing) {
        onCloseRef.current();
      }
    });
    return () => animation.stop();
  }, [entrance, reduceMotion, closing]);
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
    close();
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
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.scrim}>
        <Pressable
          accessibilityLabel="Close community sidebar"
          accessibilityRole="button"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.panel,
            {
              backgroundColor: theme.containerBg,
              borderColor: theme.cardBorder,
              opacity: entrance,
              paddingBottom: insets.bottom + 96,
              paddingLeft: insets.left + 12,
              paddingTop: insets.top + 12,
              transform: [
                {
                  translateX: entrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [
                      reduceMotion ? 0 : -Math.min(width * 0.86, 320),
                      0,
                    ],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.heading}>
            <View style={{ flex: 1 }}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={[styles.title, { color: theme.inputText }]}
              >
                {communityName}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  color: theme.dividerText,
                  fontFamily: "SofiaProReg",
                  fontSize: 12,
                  marginTop: 2,
                }}
              >
                a/{slug}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close community sidebar"
              onPress={close}
              style={styles.close}
            >
              <X color={theme.dividerText} size={18} />
            </Pressable>
          </View>
          <View
            style={[styles.sections, { borderBottomColor: theme.cardBorder }]}
          >
            <Pressable
              accessibilityRole="link"
              accessibilityState={{ selected: active === "posts" }}
              style={[
                styles.row,
                styles.tab,
                {
                  borderBottomColor:
                    active === "posts" ? accent : "transparent",
                },
              ]}
              onPress={() => {
                if (active === "posts") {
                  close();
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
                style={[
                  styles.row,
                  styles.tab,
                  {
                    borderBottomColor:
                      active === "chat" ? accent : "transparent",
                  },
                ]}
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
                Channels · {(availableChannels ?? channels).length}
              </Text>
            ) : null}
            {status === "loading" ? (
              <ZephLoader
                variant="general"
                accessibilityLabel="Loading channels"
              />
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
                  Threads
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
                      numberOfLines={2}
                      style={[styles.channelName, { color: theme.inputText }]}
                    >
                      {thread.room.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </Animated.View>
        <LinearGradient
          pointerEvents="none"
          colors={
            isDark
              ? ["rgba(23,23,23,0)", "rgba(23,23,23,0.92)"]
              : ["rgba(243,244,246,0)", "rgba(243,244,246,0.94)"]
          }
          style={{
            bottom: 0,
            height: 108 + insets.bottom,
            left: 0,
            position: "absolute",
            right: 0,
          }}
        />
        <MobileBottomNav hidden={closing} sidebar onNavigate={close} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  channelName: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 20,
  },
  close: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
  },
  error: { gap: 12, padding: 12 },
  eyebrow: {
    fontFamily: "SofiaProBold",
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: 4,
  },
  label: { fontFamily: "SofiaProBold", fontSize: 14 },
  panel: {
    borderBottomRightRadius: 16,
    borderColor: "transparent",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopRightRadius: 16,
    bottom: 0,
    left: 0,
    maxWidth: 320,
    paddingRight: 12,
    position: "absolute",
    top: 0,
    width: "86%",
  },
  row: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 10,
    marginBottom: 0,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  scrim: { backgroundColor: "rgba(0,0,0,0.55)", flex: 1 },
  sections: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 16,
    paddingBottom: 0,
  },
  staff: {
    fontFamily: "SofiaProBold",
    fontSize: 12,
  },
  tab: {
    backgroundColor: "transparent",
    borderBottomWidth: 2,
    borderRadius: 0,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 0,
  },
  threads: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12 },
  title: { fontFamily: "SofiaProBold", fontSize: 14 },
});
