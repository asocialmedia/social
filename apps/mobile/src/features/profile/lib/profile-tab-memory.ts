export const PROFILE_TABS = [
  "posts",
  "gusts",
  "responses",
  "eddies",
  "amplified",
  "media",
] as const;

export type ProfileViewTab = (typeof PROFILE_TABS)[number];

const PROFILE_TAB_SET: ReadonlySet<string> = new Set(PROFILE_TABS);

export function isProfileViewTab(value: unknown): value is ProfileViewTab {
  return typeof value === "string" && PROFILE_TAB_SET.has(value);
}

const PROFILE_TAB_STORAGE_PREFIX = "native-profile-tab:";

// Pure helpers for the sticky tab bar, kept out of the component so the pin
// threshold can be tested without mounting a FlatList.

// The in-flow tab strip pins once its top edge reaches the top of the list. The
// 1px tolerance keeps the flag from flapping when the scroll offset hovers
// exactly on the boundary, which a slow drag or a momentum settle can do.
const PIN_TOLERANCE_PX = 1;

export function shouldPinTabs(
  offsetY: number,
  tabsRestingY: number | null
): boolean {
  // Before the first layout pass there is no offset to compare against, so
  // staying unpinned is the only safe answer.
  if (tabsRestingY === null) {
    return false;
  }
  return offsetY >= tabsRestingY - PIN_TOLERANCE_PX;
}

// The pinned flag is stored with the tab it was measured under and only
// honoured while that tab is still active, so a tab switch stands the pinned
// copy down without an effect that resets it.
export function isPinCurrent(pinTab: string, activeTab: string): boolean {
  return pinTab === activeTab;
}

export function profileTabStorageKey(username: string): string {
  return `${PROFILE_TAB_STORAGE_PREFIX}${username.toLowerCase()}`;
}

export function parseProfileTab(
  value: string | null | undefined
): ProfileViewTab {
  return isProfileViewTab(value) ? value : "posts";
}
