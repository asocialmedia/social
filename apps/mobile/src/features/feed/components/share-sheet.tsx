// Post sharing mirrors web's Social, Link, QR and Messages tabs.
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { Spinner3D } from "@/components/feedback/spinner-3d";
import { toast } from "@/components/feedback/toast";
import { DialogPanel } from "@/components/surface/dialog-panel";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { fetchConversationList } from "@/features/messages/lib/client";
import type { ConversationListItem } from "@/features/messages/lib/client";
import { useSharedPostDraft } from "@/features/messages/state/shared-post-draft";
import { externalShareUrl } from "@/features/network/lib/network-paths";
import {
  SettingsButton,
  SettingsInput,
} from "@/features/settings/components/settings-ui";
import { PROD_API_URL } from "@/lib/api-base";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

import { fetchShareStats, submitShare } from "../lib/feed-api";
import type { ShareStats } from "../lib/feed-api";
import type { FeedPost } from "../lib/feed-types";
import { socialShareTargets } from "../lib/share-targets";

export function getSharePostUrl(post: FeedPost): string {
  if (post.external) {
    return externalShareUrl(post.external.id);
  }
  const shortId = post.id.length > 8 ? post.id.slice(0, 8) : post.id;
  const path = post.community?.slug
    ? `/a/${post.community.slug}/posts/${shortId}`
    : `/posts/${shortId}`;
  return `${PROD_API_URL}${path}`;
}

interface ShareSheetProps {
  // Web's dialogTitle / dialogDescription / shareUrl overrides; gusts share
  // "Share Gust" and /gusts?id=<full id> instead of the post path.
  description?: string;
  onClose: () => void;
  post: FeedPost | null;
  shareUrl?: (post: FeedPost) => string;
  title?: string;
}

export function ShareSheet(props: ShareSheetProps) {
  return props.post ? (
    <ShareDialog key={props.post.id} {...props} post={props.post} />
  ) : null;
}

function ShareDialog({
  description = "Share this post with your network",
  onClose,
  post,
  shareUrl = getSharePostUrl,
  title = "Share Post",
}: ShareSheetProps & { post: FeedPost }) {
  const { theme } = useAppTheme();
  const { user } = useSessionContext();
  const router = useRouter();
  const [tab, setTab] = useState<"social" | "link" | "qr" | "messages">("link");
  const [stats, setStats] = useState<ShareStats[]>([]);
  const [copied, setCopied] = useState(false);
  const [conversations, setConversations] = useState<ConversationListItem[]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const url = shareUrl(post);
  const caption = post.content?.slice(0, 160) || "Post on asocialmedia";
  useEffect(() => {
    let active = true;
    if (post.external) {
      return;
    }
    void (async () => {
      try {
        const rows = await fetchShareStats(post.id, {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        });
        if (active) {
          setStats(rows);
        }
      } catch {
        // Decorative statistics must not block sharing.
      }
    })();
    return () => {
      active = false;
    };
  }, [post.id, post.external]);
  const loadMessages = async (cursor?: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchConversationList(
        { apiBase: getApiBaseUrl(), cookie: await authClient.getCookie() },
        cursor
      );
      setConversations((current) =>
        cursor ? [...current, ...result.items] : result.items
      );
      setNextCursor(result.nextCursor);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Couldn't load conversations"
      );
    }
    setLoading(false);
  };
  const recordShare = async (platform: string) => {
    if (post.external) {
      return;
    }
    try {
      await submitShare(post.id, platform, {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      });
    } catch (error) {
      logWarn("feed.share_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const copy = async () => {
    await Clipboard.setStringAsync(url);
    setCopied(true);
    await recordShare("link");
  };
  const share = async () => {
    try {
      const result = await Share.share({ message: url, url });
      if (result.action === Share.sharedAction) {
        await recordShare("system");
      }
    } catch {
      toast({ description: "Try copying the link.", title: "Couldn't share" });
    }
  };
  const shareToPlatform = async (target: { platform: string; url: string }) => {
    try {
      await Linking.openURL(target.url);
      await recordShare(target.platform);
    } catch {
      toast({
        description: "Try copying the link.",
        title: "Couldn't open sharing",
      });
    }
  };
  const totalShares = stats.reduce((sum, row) => sum + row.shares, 0);
  return (
    <DialogPanel title={title} description={description} onClose={onClose}>
      <View style={styles.tabs}>
        {(["social", "link", "qr", "messages"] as const).map((value) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            key={value}
            onPress={() => {
              setTab(value);
              if (value === "messages" && user) {
                void loadMessages();
              }
            }}
            style={[
              styles.tab,
              {
                backgroundColor:
                  tab === value ? theme.passkeyBg : "transparent",
              },
            ]}
          >
            <Text
              style={{
                color: tab === value ? theme.inputText : theme.dividerText,
                fontFamily: "SofiaProMed",
                fontSize: 12,
              }}
            >
              {value === "qr"
                ? "QR code"
                : value[0].toUpperCase() + value.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === "link" ? (
        <View style={styles.body}>
          <SettingsInput label="Post link" value={url} editable={false} />
          <View style={styles.actions}>
            <SettingsButton
              label={copied ? "Copied!" : "Copy link"}
              onPress={() => {
                void copy();
              }}
            />
            <SettingsButton
              label="Share…"
              tone="gray"
              onPress={() => {
                void share();
              }}
            />
          </View>
        </View>
      ) : null}
      {tab === "social" ? (
        <View style={styles.targets}>
          {socialShareTargets(url, caption).map((target) => (
            <SettingsButton
              key={target.platform}
              label={target.label}
              tone="gray"
              onPress={() => {
                void shareToPlatform(target);
              }}
            />
          ))}
          <SettingsButton
            label="More apps…"
            onPress={() => {
              void share();
            }}
          />
        </View>
      ) : null}
      {tab === "qr" ? (
        <View style={styles.qr}>
          <View style={styles.qrCode}>
            <QRCode
              value={url}
              size={210}
              backgroundColor="white"
              color="black"
            />
          </View>
          <Text style={[styles.hint, { color: theme.dividerText }]}>
            Scan to open this post
          </Text>
          <SettingsButton
            label="Copy link"
            tone="gray"
            onPress={() => {
              void copy();
            }}
          />
        </View>
      ) : null}
      {tab === "messages" ? (
        <View style={styles.body}>
          {user ? (
            <>
              <SettingsInput
                label="Find a conversation"
                value={query}
                onChangeText={setQuery}
                placeholder="Search conversations…"
              />
              <ScrollView
                style={{ maxHeight: 240 }}
                keyboardShouldPersistTaps="handled"
              >
                {conversations
                  .filter((item) =>
                    conversationName(item, user.id)
                      .toLowerCase()
                      .includes(query.toLowerCase())
                  )
                  .map((item) => (
                    <Pressable
                      key={item.conversation.id}
                      accessibilityLabel={`Share to ${conversationName(item, user.id)}`}
                      onPress={() => {
                        useSharedPostDraft
                          .getState()
                          .attach(item.conversation.id, post.id);
                        onClose();
                        router.push(`/messages/${item.conversation.id}`);
                      }}
                      style={styles.conversation}
                    >
                      <UserAvatar
                        size={36}
                        url={
                          item.conversation.members.find(
                            (member) => member.userId !== user.id
                          )?.user.avatarUrl
                        }
                      />
                      <Text
                        numberOfLines={1}
                        style={{
                          color: theme.inputText,
                          flex: 1,
                          fontFamily: "SofiaProMed",
                        }}
                      >
                        {conversationName(item, user.id)}
                      </Text>
                      <Text style={{ color: "#f97316" }}>Attach</Text>
                    </Pressable>
                  ))}
              </ScrollView>
              {loading ? <Spinner3D size={24} /> : null}
              {loadError ? (
                <Text style={{ color: theme.dividerText }}>{loadError}</Text>
              ) : null}
              {!loading && !loadError && !conversations.length ? (
                <Text style={{ color: theme.dividerText }}>
                  No conversations yet. Start one in Messages.
                </Text>
              ) : null}
              {nextCursor ? (
                <SettingsButton
                  label="Load more"
                  tone="gray"
                  disabled={loading}
                  onPress={() => {
                    void loadMessages(nextCursor);
                  }}
                />
              ) : null}
              <Text style={[styles.hint, { color: theme.dividerText }]}>
                Choose a conversation to attach this post. You can add a message
                before sending.
              </Text>
            </>
          ) : (
            <>
              <Text style={{ color: theme.dividerText }}>
                Sign in to share this post in Messages.
              </Text>
              <SettingsButton
                label="Log in"
                onPress={() => {
                  onClose();
                  router.push("/(auth)/login");
                }}
              />
            </>
          )}
        </View>
      ) : null}
      {totalShares > 0 ? (
        <Text
          style={[styles.hint, { color: theme.dividerText, marginTop: 18 }]}
        >
          {totalShares} {totalShares === 1 ? "share" : "shares"}
        </Text>
      ) : null}
    </DialogPanel>
  );
}

function conversationName(
  item: ConversationListItem,
  viewerId: string
): string {
  if (item.conversation.type === "DEN") {
    return item.conversation.name || "Den";
  }
  const peer = item.conversation.members.find(
    (member) => member.userId !== viewerId
  )?.user;
  return peer?.displayName || peer?.username || "Conversation";
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  body: { gap: 12 },
  conversation: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
  },
  hint: { fontFamily: "SofiaProReg", fontSize: 12, textAlign: "center" },
  qr: { alignItems: "center", gap: 14 },
  qrCode: { backgroundColor: "white", borderRadius: 16, padding: 16 },
  tab: { alignItems: "center", borderRadius: 10, flex: 1, paddingVertical: 10 },
  tabs: { flexDirection: "row", gap: 4, marginBottom: 18 },
  targets: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
});
