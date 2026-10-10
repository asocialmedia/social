export type HapticFeedback =
  | "selection"
  | "hold"
  | "success"
  | "error"
  | "zoom-reset";

export async function performHapticPattern(
  feedback: HapticFeedback,
  pulse: (feedback: Exclude<HapticFeedback, "zoom-reset">) => Promise<void>,
  pause: (ms: number) => Promise<void> = (ms) =>
    // oxlint-disable-next-line promise/avoid-new -- React Native has no promise-based timer API
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  now: () => number = Date.now
): Promise<void> {
  await pulse(feedback === "zoom-reset" ? "selection" : feedback);
  if (feedback === "zoom-reset") {
    const started = now();
    await pause(65);
    // Don't replay the second tick after an app suspension or a blocked runtime.
    if (now() - started <= 120) {
      await pulse("selection");
    }
  }
}

// Drop overlapping and delayed pulses instead of replaying a burst after loading.
export function createHapticController(
  load: () => Promise<(feedback: HapticFeedback) => Promise<void>>,
  now: () => number = Date.now
): (feedback?: HapticFeedback) => void {
  let lastFeedbackAt = -Infinity;
  let pending = false;
  return (feedback = "selection") => {
    const requestedAt = now();
    if (pending || requestedAt - lastFeedbackAt < 120) {
      return;
    }
    pending = true;
    lastFeedbackAt = requestedAt;
    void (async () => {
      try {
        const perform = await load();
        if (now() - requestedAt <= 100) {
          await perform(feedback);
        }
      } catch {
        // Disabled hardware must never interrupt the action.
      } finally {
        pending = false;
      }
    })();
  };
}
