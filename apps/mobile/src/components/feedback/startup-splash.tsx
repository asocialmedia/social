import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

// Reveal the committed destination after native layout has had a frame to
// settle. No network request or second JS splash participates in this gate.
export function StartupGate({
  ready,
  onPresented,
}: {
  ready: boolean;
  onPresented: () => void;
}) {
  useEffect(() => {
    if (!ready) {
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
