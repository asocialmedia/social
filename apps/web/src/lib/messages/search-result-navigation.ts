const SEARCH_RESULT_SELECTOR = "button[data-search-result]:not(:disabled)";

export function focusSearchResult(
  container: HTMLElement | null,
  key: string,
  current: EventTarget | null = null
): boolean {
  if (!container || !["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
    return false;
  }
  const buttons = [
    ...container.querySelectorAll<HTMLButtonElement>(SEARCH_RESULT_SELECTOR),
  ];
  if (buttons.length === 0) {
    return false;
  }
  const index = buttons.indexOf(current as HTMLButtonElement);
  let nextIndex = 0;
  if (key === "End" || (key === "ArrowUp" && index === -1)) {
    nextIndex = buttons.length - 1;
  } else if (key === "ArrowDown" && index !== -1) {
    nextIndex = Math.min(buttons.length - 1, index + 1);
  } else if (key === "ArrowUp") {
    nextIndex = Math.max(0, index - 1);
  }
  const next = buttons[nextIndex];
  if (!next) {
    return false;
  }
  next.focus({ preventScroll: true });
  next.scrollIntoView?.({ block: "nearest" });
  return true;
}
