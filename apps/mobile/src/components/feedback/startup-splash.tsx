import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

async function dismissSplash(): Promise<void> {
  try {
    await SplashScreen.hideAsync();
  } catch {
    // A platform activity or Fast Refresh may already have dismissed it.
  }
}

// Reveal the committed destination after native layout has had a frame to
// settle. No network request or second JS splash participates in this gate.
export function StartupGate({
  ready,
  onPresented,
}: {
  ready: boolean;
  onPresented: () => void;
}) {
  const presented = useRef(false);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && presented.current) {
        // Activity recreation can reattach the platform splash to a live JS session.
        void dismissSplash();
      }
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!ready || presented.current) {
      return;
    }
    let cancelled = false;
    let nextFrame = 0;
    const frame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => {
        void (async () => {
          try {
            await SplashScreen.hideAsync();
          } catch {
            // Fast Refresh may already have dismissed the platform splash.
          }
          if (!cancelled) {
            presented.current = true;
            onPresented();
          }
        })();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nextFrame);
    };
  }, [onPresented, ready]);
  return null;
}
