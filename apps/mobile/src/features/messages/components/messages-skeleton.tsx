import { View } from "react-native";

import { ZephLoader } from "@/components/feedback/zeph-loader";

export function ConversationListSkeleton() {
  return (
    <View
      style={{ alignItems: "center", justifyContent: "center", minHeight: 280 }}
    >
      <ZephLoader
        accessibilityLabel="Loading conversations"
        size={96}
        variant="messages"
      />
    </View>
  );
}

export function ThreadSkeleton() {
  return (
    <View
      style={{
        alignItems: "center",
        flex: 1,
        justifyContent: "center",
        padding: 24,
      }}
    >
      <ZephLoader
        accessibilityLabel="Loading conversation"
        size={96}
        variant="messages"
      />
    </View>
  );
}
