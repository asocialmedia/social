const INTERACTIVE_TARGET_SELECTOR =
  "a, button, input, textarea, select, option, video, audio, [role='button'], [role='checkbox'], [role='menuitem'], [role='option'], [role='tab'], [role='combobox'], [data-card-interactive], [contenteditable='true']";

export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }
  const el = target as Element;
  if (typeof el.closest !== "function") {
    return false;
  }
  const isContentEditable =
    "isContentEditable" in target &&
    Boolean((target as HTMLElement).isContentEditable);
  return Boolean(el.closest(INTERACTIVE_TARGET_SELECTOR) || isContentEditable);
}
