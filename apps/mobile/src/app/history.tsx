import { networkPostAllowed } from "@asm/protocols/discovery";
import { useRouter } from "expo-router";
import { FlatList, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { z } from "zod";

import { BlueskyPostCard } from "@/features/feed/components/bluesky-post-card";
import { ManagedPostCard } from "@/features/feed/components/managed-post-card";
import { normalizePostsData } from "@/features/feed/lib/feed-types";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { networkRequest } from "@/features/network/lib/network-api";
import { useNetworkSettings } from "@/features/network/state/use-network-settings";
import { useProtocolResource } from "@/features/network/state/use-protocol-resource";
import { SettingsButton } from "@/features/settings/components/settings-ui";
import { useAppTheme } from "@/theme";

const historySchema = z.object({
  posts: z.array(
    z.custom<FeedPost>((value) =>
      Boolean(
        value &&
        typeof value === "object" &&
        "id" in value &&
        typeof value.id === "string"
      )
    )
  ),
});
export default function HistoryRoute() {
  const network = useNetworkSettings();
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const query = useProtocolResource(
    `post-history:${network.viewer}:${network.scope}`,
    async (signal) =>
      historySchema.parse(
        await networkRequest("/api/posts/history", { signal })
      ),
    network.viewer !== "guest" && network.ready
  );
  const posts = normalizePostsData(query.data?.posts ?? []).filter((post) =>
    networkPostAllowed(
      post,
      network.settings.preferences,
      network.settings.topicScope
    )
  );
  return (
    <View
      style={{
        backgroundColor: theme.containerBg,
        flex: 1,
        paddingTop: insets.top,
      }}
    >
      <View className="gap-3 p-4">
        <SettingsButton
          tone="gray"
          label="Back"
          onPress={() => router.back()}
        />
        <Text
          className="text-xl font-semibold"
          style={{ color: theme.inputText }}
        >
          Recently viewed
        </Text>
        {network.viewer === "guest" ? (
          <SettingsButton
            label="Sign in to see your history"
            onPress={() => router.push("/login")}
          />
        ) : (
          <SettingsButton
            tone="gray"
            label="Refresh history"
            disabled={query.loading}
            onPress={() => {
              void query.refetch();
            }}
          />
        )}
        {query.error ? (
          <Text style={{ color: theme.dividerText }}>{query.error}</Text>
        ) : null}
      </View>
      <FlatList
        data={posts}
        keyExtractor={(post) => post.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        renderItem={({ item }) =>
          item.external ? (
            <BlueskyPostCard post={item.external} />
          ) : (
            <ManagedPostCard
              post={item}
              onChanged={() => {
                void query.refetch();
              }}
            />
          )
        }
        ListEmptyComponent={
          <Text className="p-4" style={{ color: theme.dividerText }}>
            {query.loading ? "Loading history…" : "No recently viewed posts."}
          </Text>
        }
      />
    </View>
  );
}
