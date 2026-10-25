import { Image } from "expo-image";
import type { ActivityIndicatorProps } from "react-native";
import { View } from "react-native";

import mediaArtwork from "@/assets/images/zeph-loading-media.webp";
import messagesArtwork from "@/assets/images/zeph-loading-messages.webp";
import searchArtwork from "@/assets/images/zeph-loading-search.webp";
import securityArtwork from "@/assets/images/zeph-loading-security.webp";
import waitingArtwork from "@/assets/images/zeph-loading-waiting.webp";

const ARTWORK = {
  general: waitingArtwork,
  media: mediaArtwork,
  messages: messagesArtwork,
  search: searchArtwork,
  security: securityArtwork,
};
const SIZES = { large: 56, small: 24 };
export type ZephLoaderVariant = keyof typeof ARTWORK;

export function ZephLoader({
  animating = true,
  color: _color,
  hidesWhenStopped = true,
  size = "small",
  style,
  variant = "general",
  ...props
}: ActivityIndicatorProps & { variant?: ZephLoaderVariant }) {
  if (!animating && hidesWhenStopped) {
    return null;
  }
  const dimension = typeof size === "number" ? size : SIZES[size];
  return (
    <View
      accessibilityLabel="Loading"
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={[
        {
          alignItems: "center",
          height: dimension,
          justifyContent: "center",
          width: dimension,
        },
        style,
      ]}
      {...props}
    >
      <Image
        accessible={false}
        contentFit="contain"
        source={ARTWORK[variant]}
        style={{ height: dimension, width: dimension }}
      />
    </View>
  );
}
