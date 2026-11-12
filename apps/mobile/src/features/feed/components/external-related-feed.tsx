import { externalNetworkPostRecommended } from "@asm/protocols/discovery";
import { useEffect, useMemo } from "react";
import type { MutableRefObject } from "react";
import { StyleSheet, View } from "react-native";

import { networkRequest } from "@/features/network/lib/network-api";
import { useNetworkSettings } from "@/features/network/state/use-network-settings";
import { useProtocolPages } from "@/features/network/state/use-protocol-pages";
import { SettingsButton } from "@/features/settings/components/settings-ui";
import { useAppTheme } from "@/theme";

import { incomingFeedRows } from "../lib/feed-rows";
import { mixedFeedRows } from "../lib/mixed-feed-rows";
import { parseRelatedFeedPage } from "../lib/related-feed-page";
import { useBlueskyFeed } from "../state/use-bluesky-feed";
import { BlueskyPostCard } from "./bluesky-post-card";
import { FeedSkeleton } from "./feed-skeleton";
import { ManagedPostCard } from "./managed-post-card";

export function ExternalRelatedFeed({
  excludeUri,
  loadMoreRef,
}: {
  excludeUri: string;
  loadMoreRef: MutableRefObject<(() => void) | null>;
}) {
  const network = useNetworkSettings();
  const { theme } = useAppTheme();
  const native = useProtocolPages(
    `external-related:${network.viewer}:${network.scope}:${network.locale}`,
    async (cursor: string | null, signal) => {
      const params = new URLSearchParams({
        locale: network.locale,
        network: network.scope,
      });
      if (cursor) {
        params.set("cursor", cursor);
      }
      const payload: unknown = await networkRequest(
        `/api/posts/for-you?${params}`,
        { signal }
      );
      return parseRelatedFeedPage(payload);
    },
    network.ready
  );
  const external = useBlueskyFeed("personalized", true, network.viewer);
  const rows = useMemo(
    () =>
      mixedFeedRows(
        incomingFeedRows(
          [...new Map(native.items.map((post) => [post.id, post])).values()],
          new Set()
        ),
        external.pages
          .flatMap((page) => page.items)
          .filter(
            (post) =>
              post.id !== excludeUri &&
              externalNetworkPostRecommended(
                post,
                network.settings.preferences,
                undefined,
                network.settings.topicScope
              )
          ),
        "all",
        false
      ),
    [
      native.items,
      external.pages,
      excludeUri,
      network.settings.preferences,
      network.settings.topicScope,
    ]
  );
  const loading = native.loading || external.status === "loading";
  const loadMore = () => {
    if (loading || native.loadingMore || external.loadingMore) {
      return;
    }
    if (native.hasMore && !native.error) {
      void native.fetchNext();
    }
    if (external.hasMore && external.status !== "error") {
      void external.fetchNext();
    }
  };
  useEffect(() => {
    loadMoreRef.current = loadMore;
    return () => {
      loadMoreRef.current = null;
    };
  });
  if (loading) {
    return <FeedSkeleton source="all" />;
  }
  return (
    <View>
      {rows.map((row) => (
        <View
          key={row.id}
          style={{
            borderBottomColor: theme.cardBorder,
            borderBottomWidth: StyleSheet.hairlineWidth,
          }}
        >
          {row.kind === "bluesky" ? (
            <BlueskyPostCard post={row.value} />
          ) : (
            <ManagedPostCard
              post={row.value.post}
              hasThreadChild={row.value.hasThreadChild}
              hasThreadParent={row.value.hasThreadParent}
            />
          )}
        </View>
      ))}
      {native.loadingMore || external.loadingMore ? (
        <FeedSkeleton source="all" />
      ) : null}
      {native.error || external.status === "error" ? (
        <SettingsButton
          label="Retry related posts"
          tone="gray"
          onPress={() => {
            if (native.error) {
              void native.refresh();
            }
            if (external.status === "error") {
              void external.refresh();
            }
          }}
        />
      ) : null}
      {native.hasMore || external.hasMore ? (
        <SettingsButton
          label="Load more posts"
          tone="gray"
          onPress={loadMore}
        />
      ) : null}
    </View>
  );
}
