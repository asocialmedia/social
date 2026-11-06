import type { ExternalPost } from "@asm/protocols/contracts";
import { useRouter } from "expo-router";
import { Heart } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";

import { toast } from "@/components/feedback/toast";
import { useSessionContext } from "@/features/auth/state/session";
import { blueskyConnectionSchema } from "@/features/network/lib/bluesky-connection";
import { networkRequest } from "@/features/network/lib/network-api";
import {
  invalidateProtocolResources,
  useProtocolResource,
} from "@/features/network/state/use-protocol-resource";
import { formatNumber } from "@/lib/format/format-number";
import { useAppTheme } from "@/theme";

const likeSchema = z.object({
  liked: z.boolean(),
  likes: z.number().nullable(),
});
export function ExternalLikeAction({
  post,
  size = 16,
  color,
}: {
  post: ExternalPost;
  size?: number;
  color?: string;
}) {
  const { user } = useSessionContext();
  const router = useRouter();
  const { theme } = useAppTheme();
  const [pending, setPending] = useState(false);
  const [optimistic, setOptimistic] = useState<z.infer<
    typeof likeSchema
  > | null>(null);
  const connection = useProtocolResource(
    `bluesky-connection:${user?.id ?? "guest"}`,
    async (signal) =>
      blueskyConnectionSchema.parse(
        await networkRequest("/api/protocols/bluesky/likes", { signal })
      ),
    Boolean(user)
  );
  const key = `bluesky-like:${user?.id ?? "guest"}:${connection.data?.did ?? ""}:${post.id}`;
  const query = useProtocolResource(
    key,
    async (signal) =>
      likeSchema.parse(
        await networkRequest(
          `/api/protocols/bluesky/likes?${new URLSearchParams({ uri: post.id })}`,
          { signal }
        )
      ),
    Boolean(user && connection.data?.canLike)
  );
  const [seed, setSeed] = useState({ data: query.data, key });
  if (seed.key !== key || seed.data !== query.data) {
    setSeed({ data: query.data, key });
    setOptimistic(null);
  }
  const state = optimistic ?? query.data;
  const liked = state?.liked ?? false;
  const count = state?.likes ?? post.upstreamCounts.likes ?? null;
  const toggle = async () => {
    if (!user) {
      router.push("/login");
      return;
    }
    if (!connection.data?.canLike) {
      router.push("/settings?tab=account&section=settings-bluesky-connection");
      return;
    }
    if (query.error) {
      await query.refetch();
      return;
    }
    if (pending || query.loading) {
      return;
    }
    setPending(true);
    setOptimistic({
      liked: !liked,
      likes: count === null ? null : Math.max(0, count + (liked ? -1 : 1)),
    });
    try {
      const next = likeSchema.parse(
        await networkRequest("/api/protocols/bluesky/likes", {
          body: JSON.stringify({ active: !liked, uri: post.id }),
          method: "POST",
        })
      );
      setOptimistic(next);
      invalidateProtocolResources(key);
      await query.refetch();
    } catch (error) {
      setOptimistic(null);
      toast({
        title:
          error instanceof Error
            ? error.message
            : "Couldn't sync your Bluesky like",
        variant: "destructive",
      });
    }
    setPending(false);
  };
  let label = "Connect Bluesky to like";
  if (connection.data?.canLike) {
    label = liked ? "Unlike on Bluesky" : "Like on Bluesky";
  }
  if (query.error) {
    label = "Retry Bluesky like";
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ checked: liked, disabled: pending }}
      accessibilityLabel={label}
      disabled={pending}
      onPress={() => {
        void toggle();
      }}
      hitSlop={6}
    >
      <View className="flex-row items-center gap-1">
        <Heart
          color={liked ? "#f43f5e" : (color ?? theme.dividerText)}
          fill={liked ? "#f43f5e" : "none"}
          size={size}
        />
        <Text style={{ color: color ?? theme.dividerText, fontSize: 12 }}>
          {count === null ? "—" : formatNumber(count)}
        </Text>
      </View>
    </Pressable>
  );
}
