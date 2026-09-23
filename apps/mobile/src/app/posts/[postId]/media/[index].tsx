import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PostMediaScreen } from "@/features/post/components/post-media-screen";
import { parseMediaIndexParam } from "@/features/post/lib/post-path";
import { useAppTheme } from "@/theme";

export default function PostMediaRoute() {
  const { index, postId } = useLocalSearchParams<{
    index?: string;
    postId?: string;
  }>();
  const router = useRouter();
  const { theme } = useAppTheme();

  const mediaIndex = parseMediaIndexParam(index);
  if (typeof postId !== "string" || !postId || mediaIndex === null) {
    return (
      <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
        <Text style={[styles.title, { color: theme.inputText }]}>
          Media not found
        </Text>
        <Pressable
          accessibilityLabel="Back to post"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.btn}
        >
          <Text style={styles.btnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }
  return <PostMediaScreen initialIndex={mediaIndex} postId={postId} />;
}

const styles = StyleSheet.create({
  btn: {
    alignItems: "center",
    backgroundColor: "#ff9500",
    borderRadius: 9999,
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  btnText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  root: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontFamily: "SofiaProBold",
    fontSize: 16,
    fontWeight: "normal",
  },
});
