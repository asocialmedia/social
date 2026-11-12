import { FontAwesome6 } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useState } from "react";
import { Text, View } from "react-native";

import {
  getLinkPlatform,
  hostLabel,
} from "@/features/home/components/profile-utils";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { siteIconUrl } from "../lib/site-icon";

export function SiteIcon({ url, size = 16 }: { url: string; size?: number }) {
  const { theme } = useAppTheme();
  const platform = getLinkPlatform(url);
  const uri = siteIconUrl(getApiBaseUrl(), url);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  if (platform) {
    return (
      <FontAwesome6
        name={platform.icon}
        color={platform.color ?? theme.dividerText}
        size={size - 2}
      />
    );
  }
  return (
    <View
      className="items-center justify-center overflow-hidden rounded-sm"
      style={{ backgroundColor: theme.dividerLine, height: size, width: size }}
    >
      {loadedUri === uri ? null : (
        <Text style={{ color: theme.dividerText, fontSize: size * 0.6 }}>
          {(hostLabel(url)[0] ?? "L").toUpperCase()}
        </Text>
      )}
      {uri && failedUri !== uri ? (
        <Image
          source={{ uri }}
          cachePolicy="memory-disk"
          contentFit="contain"
          onError={() => setFailedUri(uri)}
          onLoad={() => setLoadedUri(uri)}
          style={{ height: size, position: "absolute", width: size }}
        />
      ) : null}
    </View>
  );
}
