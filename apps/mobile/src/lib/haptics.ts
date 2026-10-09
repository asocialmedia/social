import type * as Haptics from "expo-haptics";

import { createHapticController } from "./haptic-controller";
import type { HapticFeedback } from "./haptic-controller";

export type { HapticFeedback } from "./haptic-controller";
let modules: Promise<{ haptics: typeof Haptics; platform: string }> | null =
  null;

async function loadModules() {
  const [haptics, { Platform }] = await Promise.all([
    import("expo-haptics"),
    import("react-native"),
  ]);
  return { haptics, platform: Platform.OS };
}

async function performFeedback(feedback: HapticFeedback): Promise<void> {
  try {
    modules ??= loadModules();
    const { haptics, platform } = await modules;
    if (platform === "android") {
      const effects = {
        error: haptics.AndroidHaptics.Context_Click,
        hold: haptics.AndroidHaptics.Segment_Frequent_Tick,
        selection: haptics.AndroidHaptics.Segment_Frequent_Tick,
        success: haptics.AndroidHaptics.Segment_Frequent_Tick,
      };
      await haptics.performAndroidHapticsAsync(effects[feedback]);
    } else if (feedback === "selection") {
      await haptics.selectionAsync();
    } else {
      await haptics.impactAsync(haptics.ImpactFeedbackStyle.Soft);
    }
  } catch {
    // Unavailable hardware or disabled feedback must never interrupt an action.
  }
}

// Lazy loading keeps native modules out of startup and pure store tests.
export const haptic = createHapticController(async () => {
  modules ??= loadModules();
  await modules;
  return performFeedback;
});
