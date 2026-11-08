// Native port of web's CommunityChannelShortcuts
// (apps/web/src/components/communities/page/community-channel-shortcuts.tsx).
// Web renders it inside the community workspace navigation: a "Channels"
// heading with the count, skeleton rows while loading, an error with retry,
// an empty note, and one row per channel with a staff flag on announcements.
// The navigation drawer owns fetching; this is the pure list so the drawer
// and the channel screen share one rendering.
import type { CommunityChatRoom } from "@asm/messages";
import { MessageCircle } from "lucide-react-native";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { StatusActionButton } from "@/components/feedback/status-action-button";
import { ZephLoader } from "@/components/feedback/zeph-loader";
import { useAppTheme } from "@/theme";

import { buildCommunityChannelShortcuts } from "../lib/community-channel-shortcuts";

function CommunityChannelShortcuts({
  activeChannelId,
  channels,
  error,
  loading,
  onOpenChannel,
  onRetry,
  selectedAccent,
  slug,
}: {
  activeChannelId?: string;
  channels: CommunityChatRoom[];
  error: boolean;
  loading: boolean;
  onOpenChannel: (href: `/a/${string}`) => void;
  onRetry: () => void;
  selectedAccent: string;
  slug: string;
}) {
  const { theme } = useAppTheme();
  const shortcuts = buildCommunityChannelShortcuts(slug, channels);
  return (
    <View>
      <Text
        accessibilityRole="header"
        style={[styles.eyebrow, { color: theme.dividerText }]}
      >
        Channels{loading || error ? "" : ` · ${shortcuts.length}`}
      </Text>
      {loading ? (
        <ZephLoader variant="general" accessibilityLabel="Loading channels" />
      ) : null}
      {error ? (
        <View style={styles.error}>
          <Text style={{ color: theme.dividerText }}>
            Couldn’t load channels.
          </Text>
          <StatusActionButton label="Try again" onPress={onRetry} />
        </View>
      ) : null}
      {!loading && !error && shortcuts.length === 0 ? (
        <Text style={[styles.empty, { color: theme.dividerText }]}>
          No channels are available.
        </Text>
      ) : null}
      {shortcuts.map((shortcut) => {
        const selected = shortcut.id === activeChannelId;
        return (
          <Pressable
            accessibilityRole="link"
            accessibilityState={{ selected }}
            key={shortcut.id}
            onPress={() => onOpenChannel(shortcut.href)}
            style={[
              styles.row,
              selected && { backgroundColor: `${selectedAccent}18` },
            ]}
          >
            <MessageCircle
              color={selected ? selectedAccent : theme.dividerText}
              size={17}
            />
            <Text
              numberOfLines={1}
              style={[styles.channelName, { color: theme.inputText }]}
            >
              {shortcut.name}
            </Text>
            {shortcut.staff ? (
              <Text style={[styles.staff, { color: theme.dividerText }]}>
                Staff
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  channelName: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 20,
  },
  empty: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  error: { gap: 12, padding: 12 },
  eyebrow: {
    fontFamily: "SofiaProBold",
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  row: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  staff: { fontFamily: "SofiaProBold", fontSize: 12 },
});

export default memo(CommunityChannelShortcuts);
