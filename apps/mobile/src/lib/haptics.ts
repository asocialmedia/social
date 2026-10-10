import type * as Haptics from "expo-haptics";

export type HapticFeedback = "selection" | "hold" | "success" | "error";
let lastFeedbackAt = 0;
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
        error: haptics.AndroidHaptics.Reject,
        hold: haptics.AndroidHaptics.Long_Press,
        selection: haptics.AndroidHaptics.Segment_Tick,
        success: haptics.AndroidHaptics.Confirm,
      };
      await haptics.performAndroidHapticsAsync(effects[feedback]);
    } else if (feedback === "selection") {
      await haptics.selectionAsync();
    } else if (feedback === "hold") {
      await haptics.impactAsync(haptics.ImpactFeedbackStyle.Medium);
    } else {
      await haptics.notificationAsync(
        feedback === "success"
          ? haptics.NotificationFeedbackType.Success
          : haptics.NotificationFeedbackType.Error
      );
    }
  } catch {
    // Unavailable hardware or disabled feedback must never interrupt an action.
  }
}

// Lazy loading keeps native modules out of startup and pure store tests.
export function haptic(feedback: HapticFeedback = "selection"): void {
  const now = Date.now();
  if (now - lastFeedbackAt < 40) {
    return;
  }
  lastFeedbackAt = now;
  void performFeedback(feedback);
}
