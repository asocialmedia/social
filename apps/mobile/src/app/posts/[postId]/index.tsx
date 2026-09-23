import { useLocalSearchParams } from "expo-router";

import { PostDetailScreen } from "@/features/post/components/post-detail-screen";

export default function PostDetailRoute() {
  const { postId } = useLocalSearchParams<{ postId?: string }>();
  return <PostDetailScreen postId={typeof postId === "string" ? postId : ""} />;
}
