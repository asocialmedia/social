export type HapticFeedback = "selection" | "hold" | "success" | "error";

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
