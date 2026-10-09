// Settings tab state, free of React Native and Expo imports so it is
// unit-testable on Node. Web keeps the active tab in `?tab=` so a settings
// deep link lands on the right section; native keeps it as a route param for
// the same reason.

export const SETTINGS_TABS = ["account", "profile", "security"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

// Ordered for the tab strip (web's mobile settings strip reads Profile,
// Account, Security), matching FeedTabs' `{ label, value }` shape so the
// settings strip is literally the same component as every other tabbed page.
export const SETTINGS_TAB_DEFS = [
  { label: "Profile", value: "profile" },
  { label: "Account", value: "account" },
  { label: "Security", value: "security" },
] as const satisfies readonly { label: string; value: SettingsTab }[];

export interface SettingsTabMeta {
  description: string;
  label: string;
  title: string;
}

// Order matches web's SETTINGS_TABS type and the sidebar it renders.
export const SETTINGS_TAB_META: Record<SettingsTab, SettingsTabMeta> = {
  account: {
    description: "Your username, email and sign-in methods",
    label: "Account",
    title: "Account",
  },
  profile: {
    description: "How people see you across asocialmedia",
    label: "Profile",
    title: "Profile",
  },
  security: {
    description: "Password, two-factor, passkeys and sessions",
    label: "Security",
    title: "Security",
  },
};

export const DEFAULT_SETTINGS_TAB: SettingsTab = "profile";

export function isSettingsTab(value: unknown): value is SettingsTab {
  return (
    typeof value === "string" &&
    (SETTINGS_TABS as readonly string[]).includes(value)
  );
}

export function resolveSettingsTab(
  raw: string | string[] | undefined
): SettingsTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isSettingsTab(value) ? value : DEFAULT_SETTINGS_TAB;
}

/** The path for a tab, so switching tabs is a real navigation. */
export function settingsTabPath(tab: SettingsTab): string {
  return `/settings?tab=${tab}`;
}
