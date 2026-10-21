import { Text, View } from "react-native";
import { z } from "zod";

import type { FeedPost } from "@/features/feed/lib/feed-types";
import { normalizePostsData } from "@/features/feed/lib/feed-types";
import { networkRequest } from "@/features/network/lib/network-api";
import { useNetworkSettings } from "@/features/network/state/use-network-settings";
import { useProtocolPages } from "@/features/network/state/use-protocol-pages";
import { SettingsButton } from "@/features/settings/components/settings-ui";
import { useAppTheme } from "@/theme";

import { ManagedPostCard } from "./managed-post-card";

const cursorSchema = z.object({ createdAt: z.string(), id: z.string() });
const responseSchema = z.object({
  cursor: cursorSchema.nullable(),
  items: z.array(
    z.custom<FeedPost>(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof value.id === "string"
    )
  ),
});
export function ExternalResponses({ uri }: { uri: string }) {
  const network = useNetworkSettings();

  const { theme } = useAppTheme();
  const query = useProtocolPages(
    `external-responses:${network.viewer}:${uri}`,
    async (cursor: z.infer<typeof cursorSchema> | null, signal) => {
      const params = new URLSearchParams({ kind: "responses", uri });
      if (cursor) {
        params.set("cursor", JSON.stringify(cursor));
      }
      return responseSchema.parse(
        await networkRequest(`/api/protocols/bluesky/interactions?${params}`, {
          signal,
        })
      );
    }
  );
  const items = normalizePostsData([
    ...new Map(query.items.map((post) => [post.id, post])).values(),
  ]);
  return (
    <View className="gap-3 pt-4">
      <Text
        className="px-4 text-base font-semibold"
        style={{ color: theme.inputText }}
      >
        Responses on asocialmedia
      </Text>
      {items.map((post, index) => (
        <ManagedPostCard
          key={post.id}
          post={post}
          hasThreadParent={Boolean(
            post.parentPostId &&
            items.some((parent) => parent.id === post.parentPostId)
          )}
          hasThreadChild={items[index + 1]?.parentPostId === post.id}
          onChanged={() => {
            void query.refresh();
          }}
        />
      ))}
      {query.loading ? (
        <Text className="px-4" style={{ color: theme.dividerText }}>
          Loading responses…
        </Text>
      ) : null}
      {!query.loading && !items.length && !query.error ? (
        <Text className="px-4" style={{ color: theme.dividerText }}>
          No responses yet. Use Respond to post a fleet.
        </Text>
      ) : null}
      {query.error ? (
        <>
          <Text
            selectable
            className="px-4"
            style={{ color: theme.dividerText }}
          >
            {query.error}
          </Text>
          <SettingsButton
            label="Retry responses"
            tone="gray"
            onPress={() => {
              void (query.hasMore ? query.fetchNext() : query.refresh());
            }}
          />
        </>
      ) : null}
      {query.hasMore ? (
        <SettingsButton
          label="More responses"
          disabled={query.loadingMore}
          onPress={() => {
            void query.fetchNext();
          }}
        />
      ) : null}
    </View>
  );
}
