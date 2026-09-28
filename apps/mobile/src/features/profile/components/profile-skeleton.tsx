// Placeholder for the profile route while its header resolves.
//
// The geometry here is copied from profile-header.tsx on purpose: a skeleton
// only removes the loading flash if it occupies the same box the real content
// will, otherwise every block below it jumps when the data lands. Keep the two
// files in sync when the header changes.
//
// The back button stays interactive and the route mounts instantly, so the
// user can leave before the fetch resolves; only the profile body waits.
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSkeletonPulse } from "@/components/feedback/use-skeleton-pulse";
import { FeedSkeleton } from "@/features/feed/components/feed-skeleton";
import { ProfileTabs } from "@/features/profile/components/profile-tabs";
import { useAppTheme } from "@/theme";

import type { ProfileViewTab } from "../lib/profile-tab-memory";

// Tabs are inert while loading: switching one here would fight the real
// screen's tab state the moment the profile resolves.
function noop() {
  /* empty */
}

export function ProfileSkeleton({ activeTab }: { activeTab: ProfileViewTab }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const pulse = useSkeletonPulse();
  const block = { backgroundColor: theme.dividerLine };

  return (
    <View style={styles.root}>
      <Animated.View style={{ opacity: pulse }}>
        <View
          style={[
            styles.header,
            { borderBottomColor: "rgba(128,128,128,0.25)" },
          ]}
        >
          <View style={[styles.bannerWrap, { height: 140 + insets.top }]}>
            <View style={[styles.banner, block]} />
          </View>
          <View style={styles.content}>
            <View style={styles.avatarRow}>
              <View
                style={[
                  styles.avatarOverlap,
                  { borderColor: theme.containerBg },
                ]}
              >
                <View style={[styles.avatar, block]} />
              </View>
              <View style={styles.actions}>
                <View style={[styles.actionPill, styles.wide, block]} />
                <View style={[styles.actionPill, block]} />
              </View>
            </View>
            <View style={styles.identity}>
              <View style={[styles.name, block]} />
              <View style={[styles.handle, block]} />
            </View>
            <View style={styles.bio}>
              <View style={[styles.bioLine, styles.bioFull, block]} />
              <View style={[styles.bioLine, styles.bioPartial, block]} />
            </View>
            <View style={styles.metaRow}>
              <View style={[styles.meta, block]} />
            </View>
          </View>
        </View>
      </Animated.View>
      <ProfileTabs active={activeTab} onChange={noop} />
      <FeedSkeleton />
    </View>
  );
}

const styles = StyleSheet.create({
  actionPill: {
    borderRadius: 9999,
    height: 36,
    width: 88,
  },
  actions: {
    alignItems: "flex-end",
    flexDirection: "column",
    gap: 8,
    paddingBottom: 8,
  },
  avatar: {
    borderRadius: 20,
    height: 112,
    width: 112,
  },
  avatarOverlap: {
    borderRadius: 20,
    borderWidth: 4,
    overflow: "hidden",
  },
  avatarRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -56,
  },
  banner: {
    height: "100%",
    width: "100%",
  },
  bannerWrap: { overflow: "hidden" },
  bio: { marginTop: 12 },
  bioFull: { width: "100%" },
  bioLine: {
    borderRadius: 4,
    height: 12,
    marginTop: 6,
  },
  bioPartial: { width: "62%" },
  content: { paddingHorizontal: 16 },
  handle: {
    borderRadius: 4,
    height: 10,
    marginTop: 8,
    width: 110,
  },
  header: { borderBottomWidth: 1 },
  identity: { marginTop: 12 },
  meta: {
    borderRadius: 4,
    height: 10,
    width: 130,
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 12,
  },
  name: {
    borderRadius: 5,
    height: 24,
    width: 180,
  },
  root: { flex: 1 },
  wide: { width: 104 },
});
