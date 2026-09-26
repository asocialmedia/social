// Native port of web's `app/not-found.tsx`. Expo Router routes any unmatched
// deep link here, so a stale /hashtag/x or /a/slug link opens a real screen
// instead of the framework's bare default.
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";

import { StatusScreen } from "@/components/feedback/status-screen";

import errorImage from "../../assets/images/error.png";

export default function NotFound() {
  const router = useRouter();
  return (
    <StatusScreen
      action={
        <Pressable
          accessibilityLabel="Return home"
          accessibilityRole="button"
          onPress={() => {
            router.replace("/");
          }}
          style={({ pressed }) => [
            styles.action,
            { opacity: pressed ? 0.82 : 1 },
          ]}
        >
          <Text style={styles.actionText}>Return Home</Text>
        </Pressable>
      }
      description="The page you're looking for doesn't exist or has been moved."
      image={errorImage}
      title="Page not found"
    />
  );
}

const styles = StyleSheet.create({
  action: {
    backgroundColor: "#f97316",
    borderCurve: "continuous",
    borderRadius: 9999,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  actionText: { color: "#ffffff", fontFamily: "SofiaProBold", fontSize: 15 },
});
