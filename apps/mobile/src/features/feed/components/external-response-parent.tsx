// Native port of web's ExternalResponseParent
// (components/protocols/external-response-parent.tsx): the Bluesky post an ASM
// response replies to. While it loads, a 36px avatar plus two lines of
// skeleton while loading and an inline retry when the source is unavailable.
// otherwise the same ResponseParentRow a native parent uses, so a Bluesky
// source reads like any other parent (avatar on the rail, name, handle, time).
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { StatusActionButton } from "@/components/feedback/status-action-button";
import { useSkeletonPulse } from "@/components/feedback/use-skeleton-pulse";
import { useSessionContext } from "@/features/auth/state/session";
import { useProtocolResource } from "@/features/network/state/use-protocol-resource";
import { useAppTheme } from "@/theme";

import { cachedExternalPost } from "../lib/external-cache";
import { readExternalParent } from "../lib/external-interactions";
import type { FeedPost } from "../lib/feed-types";
import { ResponseParentRow } from "./post-embeds";

function ParentSkeleton() {
  const { theme } = useAppTheme();
  const pulse = useSkeletonPulse();
  const block = { backgroundColor: theme.dividerLine, opacity: pulse };
  return (
    <View
      accessibilityLabel="Loading original post"
      accessibilityState={{ busy: true }}
      style={styles.skeleton}
    >
      <Animated.View style={[styles.skeletonAvatar, block]} />
      <View style={styles.skeletonLines}>
        <Animated.View style={[styles.skeletonName, block]} />
        <Animated.View style={[styles.skeletonBody, block]} />
      </View>
    </View>
  );
}

export function ExternalResponseParent({ post }: { post: FeedPost }) {
  const { user } = useSessionContext();
  const { theme } = useAppTheme();
  const uri = post.externalParent?.uri ?? "";
  const viewer = user?.id ?? "guest";
  const query = useProtocolResource(
    `external-parent:${viewer}:${uri}`,
    (signal) => readExternalParent(uri, signal)
  );
  const source =
    query.data === undefined ? cachedExternalPost(uri, viewer) : query.data;

  if (source === undefined && query.loading) {
    return <ParentSkeleton />;
  }
  if (query.error && !source) {
    return (
      <View style={styles.error}>
        <Text
          accessibilityRole="alert"
          style={[styles.message, { color: theme.dividerText }]}
        >
          Original Bluesky post temporarily unavailable.
        </Text>
        <StatusActionButton
          disabled={query.loading}
          label={query.loading ? "Trying again…" : "Try again"}
          onPress={() => {
            void query.refetch();
          }}
        />
      </View>
    );
  }
  return <ResponseParentRow externalSource={source ?? null} post={post} />;
}

const styles = StyleSheet.create({
  error: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingBottom: 8,
  },
  message: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
  },
  // `flex gap-3 pb-3`.
  skeleton: {
    flexDirection: "row",
    gap: 12,
    paddingBottom: 12,
  },
  skeletonAvatar: { borderRadius: 12, height: 36, width: 36 },
  skeletonBody: { borderRadius: 6, height: 48, width: "100%" },
  skeletonLines: { flex: 1, gap: 8 },
  skeletonName: { borderRadius: 4, height: 16, width: 144 },
});
