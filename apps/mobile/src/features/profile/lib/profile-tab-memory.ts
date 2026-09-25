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

export function profileTabStorageKey(username: string): string {
  return `${PROFILE_TAB_STORAGE_PREFIX}${username.toLowerCase()}`;
}

export function parseProfileTab(
  value: string | null | undefined
): ProfileViewTab {
  return isProfileViewTab(value) ? value : "posts";
}
