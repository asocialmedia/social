// oxlint-disable react/todo -- Async mutations release their guard after success and failure.
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { z } from "zod";

import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { useExternalFollowRevision } from "../state/use-external-follow";

const schema = z.object({
  authors: z
    .array(
      z.object({
        did: z.string(),
        displayName: z.string(),
        handle: z.string(),
        status: z.string(),
      })
    )
    .max(100),
});
type Author = z.infer<typeof schema>["authors"][number];

export function ExternalFollowingScreen() {
  const { user } = useSessionContext();
  return <ExternalFollowingContent key={user?.id ?? "guest"} />;
}

function ExternalFollowingContent() {
  const { user } = useSessionContext();
  const router = useRouter();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [authors, setAuthors] = useState<Author[]>([]);
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading"
  );
  const [removing, setRemoving] = useState<string | null>(null);
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!user) {
        return;
      }
      try {
        const cookie = await authClient.getCookie();
        const response = await fetch(
          `${getApiBaseUrl()}/api/protocols/bluesky/follows`,
          {
            headers: {
              "x-asm-client": "mobile",
              ...(cookie ? { cookie } : {}),
            },
            signal,
          }
        );
        if (!response.ok) {
          throw new Error("Follow list unavailable");
        }
        const next = schema.parse(await response.json());
        if (!signal.aborted) {
          setAuthors(next.authors);
          setStatus("success");
        }
      } catch {
        if (!signal.aborted) {
          setStatus("error");
        }
      }
    },
    [user]
  );
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void load(controller.signal);
      }
    });
    return () => controller.abort();
  }, [load]);
  const remove = async (did: string) => {
    if (!user || removing) {
      return;
    }
    setRemoving(did);
    try {
      const cookie = await authClient.getCookie();
      const response = await fetch(
        `${getApiBaseUrl()}/api/protocols/bluesky/follows`,
        {
          body: JSON.stringify({ active: false, actor: did }),
          headers: {
            "content-type": "application/json",
            "x-asm-client": "mobile",
            ...(cookie ? { cookie } : {}),
          },
          method: "POST",
          signal: AbortSignal.timeout(20_000),
        }
      );
      if (!response.ok) {
        throw new Error("Unfollow failed");
      }
      setAuthors((current) => current.filter((author) => author.did !== did));
      useExternalFollowRevision.getState().changed(user.id);
    } catch {
      toast({
        title: "Couldn't unfollow. Please try again.",
        variant: "destructive",
      });
    } finally {
      setRemoving(null);
    }
  };
  let emptyLabel =
    "No Bluesky accounts followed yet. Use a post's menu to follow in ASM.";
  if (status === "loading") {
    emptyLabel = "Loading followed accounts…";
  } else if (status === "error") {
    emptyLabel = "Couldn't load followed accounts.";
  }
  return (
    <View
      style={{ backgroundColor: theme.cardBg, flex: 1, paddingTop: insets.top }}
    >
      <Pressable className="px-4 py-4" onPress={() => router.back()}>
        <Text style={{ color: theme.inputText }}>Back · Bluesky follows</Text>
      </Pressable>
      <Text className="px-4 pb-4 text-sm" style={{ color: theme.dividerText }}>
        Accounts you follow in ASM. No linked Bluesky account required.
      </Text>
      {user ? (
        <FlatList
          data={authors}
          keyExtractor={(author) => author.did}
          ListEmptyComponent={
            <Text className="p-4 text-sm" style={{ color: theme.inputText }}>
              {emptyLabel}
            </Text>
          }
          ListHeaderComponent={
            status === "error" ? (
              <Pressable
                className="p-4"
                onPress={() => {
                  void load(AbortSignal.timeout(15_000));
                }}
              >
                <Text style={{ color: theme.inputText }}>Retry</Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => (
            <View className="flex-row items-center justify-between gap-3 px-4 py-3">
              <View className="flex-1">
                <Text numberOfLines={1} style={{ color: theme.inputText }}>
                  {item.displayName || item.handle}
                </Text>
                <Text
                  numberOfLines={1}
                  className="text-xs"
                  style={{ color: theme.dividerText }}
                >
                  @{item.handle}
                  {item.status === "active" ? "" : ` · ${item.status}`}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                className="rounded-full px-4 py-3"
                disabled={Boolean(removing)}
                onPress={() => {
                  void remove(item.did);
                }}
                style={{ backgroundColor: theme.containerBg }}
              >
                <Text style={{ color: theme.inputText }}>
                  {removing === item.did ? "Removing…" : "Unfollow"}
                </Text>
              </Pressable>
            </View>
          )}
        />
      ) : (
        <Pressable className="p-4" onPress={() => router.push("/login")}>
          <Text style={{ color: theme.inputText }}>
            Sign in to manage follows
          </Text>
        </Pressable>
      )}
    </View>
  );
}
