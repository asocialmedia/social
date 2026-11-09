// Web's inline <FollowButton className="h-7 px-3 text-xs"> next to the author
// handle on post cards (components/home/feedview/post-card.tsx). Follow wears
// the orange 3D pill and Following the neutral gray one, through the same
// tone helper as the profile header.
import { memo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import { followButtonTone } from "@/features/profile/lib/follow-button-tone";
import { useAppTheme } from "@/theme";

import type { FeedPost } from "../lib/feed-types";
import { useAuthorFollow } from "../state/use-author-follow";

// Chrome text scales with the system setting only this far, so the 28px pill
// never clips its label.
const CHROME_FONT_SCALE_CAP = 1.3;

export const FeedFollowButton = memo(
  ({ post, viewerId }: { post: FeedPost; viewerId: string | undefined }) => {
    const { isDark } = useAppTheme();
    const { following, pending, toggle } = useAuthorFollow(post, viewerId);
    const tone = followButtonTone(isDark, following);
    const name = post.user?.displayName || post.user?.username || "this user";
    return (
      <Pressable
        accessibilityLabel={following ? `Unfollow ${name}` : `Follow ${name}`}
        accessibilityRole="button"
        accessibilityState={{ busy: pending, disabled: pending }}
        disabled={pending}
        hitSlop={6}
        onPress={(event) => {
          // The card behind the pill opens the post on press.
          event.stopPropagation();
          void toggle();
        }}
        style={({ pressed }) => [
          styles.pressable,
          pending && styles.pending,
          { transform: [{ translateY: pressed ? 1 : 0 }] },
        ]}
      >
        <Gradient3D
          colors={tone.colors}
          radius={9999}
          shadows={tone.shadows}
          style={styles.pill}
        >
          <Text
            maxFontSizeMultiplier={CHROME_FONT_SCALE_CAP}
            numberOfLines={1}
            style={[styles.label, { color: tone.textColor }]}
          >
            {following ? "Following" : "Follow"}
          </Text>
        </Gradient3D>
      </Pressable>
    );
  }
);
FeedFollowButton.displayName = "FeedFollowButton";

const styles = StyleSheet.create({
  label: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
  },
  pending: {
    opacity: 0.7,
  },
  pill: {
    height: 28,
    paddingHorizontal: 12,
  },
  pressable: {
    flexShrink: 0,
  },
});
