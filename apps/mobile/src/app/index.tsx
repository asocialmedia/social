import { Image } from "expo-image";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";

export default function IndexScreen() {
  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-neutral-950 p-6">
      <View className="items-center justify-center gap-6">
        <View className="overflow-hidden rounded-full border-2 border-neutral-700 bg-neutral-800 shadow-lg">
          <Image
            source={avatarPlaceholder}
            style={{ height: 128, width: 128 }}
            contentFit="cover"
          />
        </View>
        <View className="items-center gap-2">
          <Text className="text-2xl font-bold tracking-tight text-white">
            asocialmedia
          </Text>
          <View className="rounded-full bg-neutral-800 px-3 py-1">
            <Text className="text-xs font-semibold tracking-wide text-neutral-400">
              WORK IN PROGRESS
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
