// Simple module-scoped flag tracking whether any popup (dialog/menu) is open.
// Used by the post card to avoid navigating when dismissing a popup via an
// outside click, since the popup is unmounted before the click finishes
// bubbling through the React tree.
let popupCount = 0;

export function setPopupOpen(open: boolean): void {
  if (open) {
    popupCount += 1;
  } else {
    popupCount = Math.max(0, popupCount - 1);
  }
}

export function isPopupOpen(): boolean {
  return popupCount > 0;
}
