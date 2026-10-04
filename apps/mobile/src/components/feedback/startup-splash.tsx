// Startup gate: dismisses the platform splash at the right moment.
//
// There is exactly ONE splash screen: the native one (logo on the brand
// background, configured in app.json). An earlier revision rendered a second,
// JS-driven brand overlay on top of it (logo plus wordmark and tagline), so
// every cold start read as two splashes back to back. This gate renders
// nothing and only decides WHEN the native splash may go.
//
// The native splash hides on fonts, not on the session. Persisted feed rows
// paint instantly behind it while the session revalidates in the background
// (stale-while-revalidate), so a slow or offline session never holds the
// splash. The header and composer already handle a pending session without
// flashing (they render nothing until known), and the root layout holds its
// first frame until fonts load, so the frame revealed here is already fully
// styled. No overlay is needed to cover anything.
//
// A short timeout backstops the gate: fonts that never settle (missing asset)
// must not strand someone on the splash.
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";

// Backstop for fonts that never settle. The normal path hides on fontsReady
// immediately; only a stuck font load hits this.
const MAX_HOLD_MS = 1200;

export function StartupGate({ fontsReady }: { fontsReady: boolean }) {
  const [overdue, setOverdue] = useState(false);

  // Releases the gate when fonts never resolve.
  useEffect(() => {
    if (fontsReady) {
      return;
    }
    const timer = setTimeout(() => setOverdue(true), MAX_HOLD_MS);
    return () => clearTimeout(timer);
  }, [fontsReady]);

  // Hides on fonts, not on the session. The session revalidates behind the
  // cached feed instead of holding the splash.
  const ready = fontsReady || overdue;

  useEffect(() => {
    if (!ready) {
      return;
    }
    // Rejects when the splash is already gone (fast refresh, or a slow gate
    // that lost a race); there is nothing left to do in that case.
    async function hideNativeSplash() {
      try {
        await SplashScreen.hideAsync();
      } catch {
        // Already dismissed; nothing to restore.
      }
    }
    void hideNativeSplash();
  }, [ready]);

  return null;
}
