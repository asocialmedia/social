// oxlint-disable react/todo -- Async mutations release request guards in finally, including failed requests.
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSessionContext } from "@/features/auth/state/session";
import { useProtocolPages } from "@/features/network/state/use-protocol-pages";
import { useAppTheme } from "@/theme";

import {
  externalLibrarySchema,
  externalRequest,
} from "../lib/external-interactions";
import { BlueskyPostCard } from "./bluesky-post-card";

export function ExternalLibraryScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [kind, setKind] = useState<"bookmarks" | "amplified">("bookmarks");
  const { user } = useSessionContext();
  const pages = useProtocolPages(
    `external-library:${user?.id ?? "guest"}:${kind}`,
    async (
      cursor: { updatedAt: string; externalPostId: string } | null,
      signal
    ) => {
      const query = new URLSearchParams({ kind });
      if (cursor) {
        query.set("cursor", JSON.stringify(cursor));
      }
      return externalLibrarySchema.parse(
        await externalRequest(query, { signal })
      );
    },
    Boolean(user)
  );
  const items = [
    ...new Map(pages.items.map((item) => [item.uri, item])).values(),
  ];
  const loading = pages.loading || pages.loadingMore;
  const { error } = pages;
  return (
    <View
      style={{ backgroundColor: theme.cardBg, flex: 1, paddingTop: insets.top }}
    >
      <Pressable className="px-4 py-4" onPress={() => router.back()}>
        <Text style={{ color: theme.inputText }}>Back · Bluesky</Text>
      </Pressable>
      <Pressable
        className="px-4 py-3"
        onPress={() => router.push("/external-following")}
      >
        <Text style={{ color: theme.inputText }}>
          Manage Bluesky follows in ASM
        </Text>
      </Pressable>
      <View className="flex-row gap-6 px-4 py-3">
        <Pressable onPress={() => setKind("bookmarks")}>
          <Text
            style={{
              color: theme.inputText,
              fontWeight: kind === "bookmarks" ? "700" : "400",
            }}
          >
            Saved
          </Text>
        </Pressable>
        <Pressable onPress={() => setKind("amplified")}>
          <Text
            style={{
              color: theme.inputText,
              fontWeight: kind === "amplified" ? "700" : "400",
            }}
          >
            Amplified
          </Text>
        </Pressable>
      </View>
      {error ? (
        <Pressable
          onPress={() => {
            void pages.refresh();
          }}
        >
          <Text className="p-4" style={{ color: theme.dividerText }}>
            Couldn't load posts. Try again.
          </Text>
        </Pressable>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.uri}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        renderItem={({ item }) =>
          item.post ? (
            <BlueskyPostCard post={item.post} />
          ) : (
            <Pressable
              onPress={() =>
                router.push({
                  params: { uri: item.uri },
                  pathname: "/external-post",
                })
              }
            >
              <Text className="p-4" style={{ color: theme.dividerText }}>
                Source post unavailable. Open asocialmedia discussion.
              </Text>
            </Pressable>
          )
        }
        ListEmptyComponent={
          <Text
            className="p-8 text-center"
            style={{ color: theme.dividerText }}
          >
            {loading ? "Loading posts…" : "No posts here yet."}
          </Text>
        }
        ListFooterComponent={
          pages.hasMore ? (
            <Pressable
              disabled={loading}
              onPress={() => {
                void pages.fetchNext();
              }}
            >
              <Text
                className="p-4 text-center"
                style={{ color: theme.inputText }}
              >
                Load more
              </Text>
            </Pressable>
          ) : undefined
        }
      />
    </View>
  );
}
