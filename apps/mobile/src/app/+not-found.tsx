// Native port of web's `app/not-found.tsx`. Expo Router routes any unmatched
// deep link here, so a stale /hashtag/x or /a/slug link opens a real screen
// instead of the framework's bare default.
import { useRouter } from "expo-router";

import errorImage from "@/assets/images/error.png";
import { StatusActionButton } from "@/components/feedback/status-action-button";
import { StatusScreen } from "@/components/feedback/status-screen";

export default function NotFound() {
  const router = useRouter();
  return (
    <StatusScreen
      action={
        <StatusActionButton
          label="Return Home"
          onPress={() => {
            router.replace("/");
          }}
        />
      }
      description="The page you're looking for doesn't exist or has been moved."
      image={errorImage}
      title="Page not found"
    />
  );
}
