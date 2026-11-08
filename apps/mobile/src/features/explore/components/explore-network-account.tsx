// Native port of web's ExploreNetworkAccount (components/discover/
// explore-network-cards.tsx): the recommended-account card woven into the
// Explore masonry after every sixth post. A `surface-3d` tile, p-4, with a
// centred 64px avatar, name (plus the Bluesky mark for Bluesky accounts),
// @handle, the two-line reason and the shared suggested follow pill.
import type { RecommendedAccount } from "@asm/protocols/discovery";
import { useRouter } from "expo-router";
import type { Href } from "expo-router";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { BlueskyIcon } from "@/features/feed/components/bluesky-icon";
import { nativeNetworkPath } from "@/features/network/lib/network-paths";
import { SuggestedFollowButton } from "@/features/search/components/suggested-follow-button";
import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK, useAppTheme } from "@/theme";

// The server href (web's short `/<username>` or a Bluesky profile path) maps
// through the shared route table; an ASM handle that does not map still
// opens its /users/ profile.
function accountRoute(account: RecommendedAccount): string | null {
  return (
    nativeNetworkPath(account.href) ??
    (account.source === "asm"
      ? `/users/${encodeURIComponent(account.handle)}`
      : null)
  );
}

export const ExploreNetworkAccount = memo(
  ({ account }: { account: RecommendedAccount }) => {
    const router = useRouter();
    const { isDark, theme } = useAppTheme();
    const route = accountRoute(account);
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.cardBg,
            borderColor: theme.cardBorder,
            boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
          },
        ]}
      >
        <Pressable
          accessibilityLabel={`View ${account.displayName}'s profile`}
          accessibilityRole="button"
          disabled={!route}
          onPress={() => {
            if (route) {
              router.push(route as Href);
            }
          }}
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <UserAvatar seed={account.id} size={64} url={account.avatarUrl} />
          <View style={styles.nameRow}>
            <Text
              numberOfLines={1}
              style={[styles.name, { color: theme.inputText }]}
            >
              {account.displayName}
            </Text>
            {account.source === "bluesky" ? <BlueskyIcon size={14} /> : null}
          </View>
          <Text
            numberOfLines={1}
            style={[styles.handle, { color: theme.dividerText }]}
          >
            @{account.handle}
          </Text>
        </Pressable>
        <Text
          numberOfLines={2}
          style={[styles.reason, { color: theme.dividerText }]}
        >
          {account.reason}
        </Text>
        <SuggestedFollowButton
          account={account}
          blue={false}
          onAuthRedirect={() => {
            // The pill pushes /login itself; Explore has nothing to close.
          }}
        />
      </View>
    );
  }
);
ExploreNetworkAccount.displayName = "ExploreNetworkAccount";

const styles = StyleSheet.create({
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    overflow: "hidden",
    padding: 16,
    width: "100%",
  },
  handle: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    textAlign: "center",
    width: "100%",
  },
  link: { alignItems: "center", gap: 8, minWidth: 0 },
  name: { flexShrink: 1, fontFamily: "SofiaProBold", fontSize: 14 },
  nameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    maxWidth: "100%",
  },
  pressed: { opacity: 0.88 },
  reason: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    marginVertical: 12,
    textAlign: "center",
  },
});
