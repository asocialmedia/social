// oxlint-disable react/todo -- Async mutations release request guards in finally, including failed requests.
import type { ExternalPost } from "@asm/protocols/contracts";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppTheme } from "@/theme";

import {
  externalLibrarySchema,
  externalRequest,
} from "../lib/external-interactions";
import { BlueskyPostCard } from "./bluesky-post-card";

interface Item {
  uri: string;
  post: ExternalPost | null;
}
export function ExternalLibraryScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [kind, setKind] = useState<"bookmarks" | "amplified">("bookmarks");
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<{
    updatedAt: string;
    externalPostId: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const busy = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const load = useCallback(
    async (after: typeof cursor, signal?: AbortSignal) => {
      if (busy.current) {
        return;
      }
      busy.current = true;
      const controller = new AbortController();
      activeRequest.current = controller;
      const requestSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;
      setLoading(true);
      try {
        const query = new URLSearchParams({ kind });
        if (after) {
          query.set("cursor", JSON.stringify(after));
        }
        const page = externalLibrarySchema.parse(
          await externalRequest(query, { signal: requestSignal })
        );
        if (!requestSignal.aborted && activeRequest.current === controller) {
          setItems((current) =>
            after ? [...current, ...page.items].slice(-400) : page.items
          );
          setCursor(page.cursor);
          setError(false);
        }
      } catch {
        if (!requestSignal.aborted && activeRequest.current === controller) {
          setError(true);
        }
      } finally {
        if (activeRequest.current === controller) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    [kind]
  );
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        busy.current = false;
        activeRequest.current?.abort();
        setItems([]);
        setCursor(null);
        void load(null, controller.signal);
      }
    });
    return () => {
      controller.abort();
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [load]);
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
            void load(null);
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
          cursor ? (
            <Pressable
              disabled={loading}
              onPress={() => {
                void load(cursor);
              }}
            >
              <Text
                className="p-4 text-center"
                style={{ color: theme.inputText }}
              >
                Load more
              </Text>
            </Pressable>
          ) : null
        }
      />
    </View>
  );
}
