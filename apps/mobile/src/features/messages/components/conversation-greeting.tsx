import { Image } from "expo-image";
import { Text, View } from "react-native";

import greetingArtwork from "@/assets/images/zeph-say-hi.webp";
import { useAppTheme } from "@/theme";

export function ConversationGreeting({
  name,
  isDen = false,
}: {
  name: string;
  isDen?: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={{ alignItems: "center", gap: 12, padding: 24 }}>
      <Text
        style={{
          color: theme.dividerText,
          fontSize: 14,
          fontWeight: "500",
          textAlign: "center",
        }}
      >
        {isDen ? `Say hi in ${name}` : `Say hi to ${name}`}
      </Text>
      <Image
        accessibilityLabel="Zeph waving hello"
        accessible
        contentFit="contain"
        source={greetingArtwork}
        style={{ height: 144, width: 144 }}
      />
    </View>
  );
}
