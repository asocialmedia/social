import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { readExternal } from "@/features/feed/lib/external-interactions";
import { externalPostView } from "@/features/feed/lib/external-post-view";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { PostMediaScreen } from "@/features/post/components/post-media-screen";

export default function ExternalMediaRoute() {
  const { uri, index } = useLocalSearchParams<{
    uri: string;
    index?: string;
  }>();
  const [result, setResult] = useState<{
    uri: string;
    post: FeedPost | null;
    failed: boolean;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const payload = await readExternal(uri, undefined, controller.signal);
        if (!controller.signal.aborted) {
          setResult({
            failed: !payload.post,
            post: payload.post ? externalPostView(payload.post) : null,
            uri,
          });
        }
      } catch {
        if (!controller.signal.aborted) {
          setResult({ failed: true, post: null, uri });
        }
      }
    })();
    return () => controller.abort();
  }, [uri]);
  const post = result?.uri === uri ? result.post : null;
  const failed = result?.uri === uri && result.failed;
  return post ? (
    <PostMediaScreen
      key={post.id}
      initialIndex={Number(index) || 0}
      initialPost={post}
      postId={uri}
    />
  ) : (
    <View className="flex-1 items-center justify-center bg-black">
      {failed ? (
        <Text className="text-white">Couldn't load this media.</Text>
      ) : (
        <ActivityIndicator color="white" />
      )}
    </View>
  );
}
