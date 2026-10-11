// Touch gestures belong to the bubble, while desktop row gestures keep their
// wider hit area. Resolve ancestry only; never measure layout in pointer handlers.
export function findMessageGestureRow(
  target: Element,
  bubbleOnly: boolean
): HTMLElement | null {
  const surface = bubbleOnly ? target.closest("[data-message-bubble]") : target;
  return surface?.closest<HTMLElement>("[data-message-id]") ?? null;
}
