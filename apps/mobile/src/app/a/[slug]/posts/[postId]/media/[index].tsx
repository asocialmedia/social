// A community post's shareable media route:
// /a/<community>/posts/<postId>/media/<index>, mirroring web's
// app/(main)/a/[slug]/posts/[postId]/media/[index]/page.tsx, which renders the
// post's media viewer at the given attachment index. Web redirects
// non-canonical requests (wrong community, bad index shape, audio-only target)
// to the canonical address; natively the screen below shows its own
// not-found/empty states, and closing with no back stack returns to the
// namespaced community post rather than the global post route.
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PostMediaScreen } from "@/features/post/components/post-media-screen";
import { parseMediaIndexParam } from "@/features/post/lib/post-path";
import { useAppTheme } from "@/theme";

export default function CommunityPostMediaRoute() {
  const { index, postId, slug } = useLocalSearchParams<{
    index?: string;
    postId?: string;
    slug?: string;
  }>();
  const router = useRouter();
  const { theme } = useAppTheme();

  const mediaIndex = parseMediaIndexParam(index);
  if (
    typeof postId !== "string" ||
    !postId ||
    typeof slug !== "string" ||
    !slug ||
    mediaIndex === null
  ) {
    return (
      <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
        <Text style={[styles.title, { color: theme.inputText }]}>
          Media not found
        </Text>
        <Pressable
          accessibilityLabel="Back to post"
          accessibilityRole="button"
          onPress={() => {
            // A cold deep link has no history to return to.
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/");
            }
          }}
          style={styles.btn}
        >
          <Text style={styles.btnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <PostMediaScreen
      communitySlug={typeof slug === "string" ? slug : undefined}
      initialIndex={mediaIndex}
      postId={postId}
      postHref={{
        params: { postId, slug },
        pathname: "/a/[slug]/posts/[postId]/index",
      }}
    />
  );
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
