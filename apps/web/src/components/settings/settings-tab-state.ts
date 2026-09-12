import type { SettingsTab } from "./settings-search";

type SettingsSearchParams = Pick<URLSearchParams, "get" | "has">;

const SETTINGS_TABS = new Set<SettingsTab>(["profile", "account", "security"]);

export function getSettingsTab(
  searchParams: SettingsSearchParams
): SettingsTab {
  const requestedTab = searchParams.get("tab");
  if (requestedTab && SETTINGS_TABS.has(requestedTab as SettingsTab)) {
    return requestedTab as SettingsTab;
  }

  // OAuth-link callbacks use these parameters to surface the account result.
  // Preserve that useful destination when an explicit tab was not requested.
  if (
    searchParams.has("account_error") ||
    searchParams.has("account_success")
  ) {
    return "account";
  }

  return "profile";
}

export function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.has(value as SettingsTab);
}
