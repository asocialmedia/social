// Web's `components/communities/page/community-mature-gate.tsx`.
//
// The gate is a panel floating OVER the community page rather than a screen of
// its own, so the reader sees exactly what they are being asked to confirm
// instead of an anonymous wall. Web blurs the page underneath with CSS; native
// has no backdrop-filter, so the community behind is dimmed by a scrim and held
// out of the accessibility tree, which is the honest equivalent.
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

import errorImage from "@/assets/images/error.png";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { APPLE_PANEL_TOKENS } from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";

import type { CommunityData } from "../lib/communities-api";
import { CommunityAvatar } from "./community-avatar";

export function CommunityMatureGate({
  community,
  onEnter,
  onLeave,
}: {
  community: CommunityData;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { isDark, theme } = useAppTheme();
  const panel = isDark ? APPLE_PANEL_TOKENS.dark : APPLE_PANEL_TOKENS.light;
  return (
    <View style={styles.root}>
      {/* The surface colour at partial opacity rather than black, so the
          community behind still reads through it. One alpha serves both
          themes because the colour already follows the app's theme. */}
      <View
        style={[styles.scrim, { backgroundColor: `${theme.containerBg}d9` }]}
      />
      <View
        style={[
          styles.panel,
          { backgroundColor: panel.background, boxShadow: panel.shadows },
        ]}
      >
        <View style={styles.identity}>
          <CommunityAvatar
            community={{
              accentColor: community.accentColor,
              avatarUrl: community.avatarUrl,
              name: community.name,
              slug: community.slug,
            }}
            size={36}
          />
          <View style={styles.identityCopy}>
            <Text
              numberOfLines={1}
              style={[styles.communityName, { color: theme.inputText }]}
            >
              {community.name}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.communitySlug, { color: theme.dividerText }]}
            >
              a/{community.slug}
            </Text>
          </View>
        </View>
        <Image contentFit="contain" source={errorImage} style={styles.art} />
        <Text style={[styles.title, { color: theme.inputText }]}>
          a/{community.slug} is marked 18+
        </Text>
        <Text style={[styles.body, { color: theme.dividerText }]}>
          This community may contain mature content. You must be over 18 to view
          and contribute.
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={onLeave}
            style={styles.action}
          >
            {({ pressed }) => (
              <Gradient3D
                colors={
                  isDark ? ["#4a4a4a", "#333333"] : ["#f7f8fa", "#e4e7ec"]
                }
                radius={9999}
                shadows={
                  isDark
                    ? "inset 0 0 0 1px rgba(255,255,255,0.18), inset 0 1.5px 2px rgba(255,255,255,0.35), 0 0 0 1px rgba(0,0,0,0.7)"
                    : "inset 0 0 0 1px rgba(255,255,255,0.85), inset 0 1.5px 2px rgba(255,255,255,0.95), 0 0 0 1px rgba(0,0,0,0.1), 0 1px 1px rgba(0,0,0,0.03), 0 2px 4px rgba(0,0,0,0.06)"
                }
                style={[styles.pill, pressed && styles.pressed]}
              >
                <Text style={styles.secondaryText}>Go back</Text>
              </Gradient3D>
            )}
          </Pressable>
          <Pressable
            accessibilityLabel="Confirm you are 18 or older"
            accessibilityRole="button"
            onPress={onEnter}
            style={styles.action}
          >
            {({ pressed }) => (
              <Gradient3D
                colors={
                  pressed ? ["#e65500", "#d44a00"] : ["#ff9500", "#e65500"]
                }
                radius={9999}
                shadows={
                  pressed
                    ? "inset 0 0 0 1px rgba(255,255,255,0.2), inset 0 1px 2px rgba(255,255,255,0.18), 0 0 0 1px rgba(170,60,0,0.95), 0 1px 2px rgba(0,0,0,0.08)"
                    : "inset 0 0 0 1px rgba(255,255,255,0.25), inset 0 1.5px 2px rgba(255,255,255,0.5), 0 0 0 1px rgba(170,60,0,0.95), 0 1px 1px rgba(255,255,255,0.4), 0 3px 5px rgba(0,0,0,0.12)"
                }
                style={[styles.pill, pressed && styles.pressed]}
              >
                <Text style={styles.primaryText}>I am 18 or older</Text>
              </Gradient3D>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  action: { width: "100%" },
  actions: { gap: 8, marginTop: 20, width: "100%" },
  art: { height: 112, marginTop: 18, width: 112 },
  body: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 19,
    marginTop: 8,
    maxWidth: 280,
    textAlign: "center",
  },
  communityName: { fontFamily: "SofiaProMed", fontSize: 14 },
  communitySlug: { fontFamily: "SofiaProReg", fontSize: 12 },
  identity: { alignItems: "center", flexDirection: "row", gap: 10 },
  identityCopy: { flex: 1, minWidth: 0 },
  panel: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 24,
    maxWidth: 420,
    paddingHorizontal: 24,
    paddingVertical: 28,
    width: "100%",
  },
  pill: { height: 40, paddingHorizontal: 20 },
  pressed: { transform: [{ translateY: 1 }] },
  primaryText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  root: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    padding: 16,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 30,
  },
  scrim: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  secondaryText: {
    color: "#1f2430",
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  title: {
    fontFamily: "SofiaProBold",
    fontSize: 18,
    marginTop: 16,
    textAlign: "center",
  },
});
