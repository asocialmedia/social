import type { SettingsTab } from "./settings-search";

interface SettingsTabMeta {
  label: string;
  tab: SettingsTab;
}

// The tab strip order and the one human label for each tab. Kept here rather
// than in the client component so the document title, the search chip and the
// strip itself can never drift apart.
export const SETTINGS_TAB_META: readonly SettingsTabMeta[] = [
  { label: "Profile", tab: "profile" },
  { label: "Account", tab: "account" },
  { label: "Privacy", tab: "privacy" },
  { label: "Security", tab: "security" },
  { label: "Personalization", tab: "personalization" },
  { label: "Network", tab: "network" },
];

export const SETTINGS_TAB_ORDER: readonly SettingsTab[] = SETTINGS_TAB_META.map(
  (entry) => entry.tab
);

const SETTINGS_TABS = new Set<SettingsTab>(SETTINGS_TAB_ORDER);

export const SETTINGS_TAB_LABELS = Object.fromEntries(
  SETTINGS_TAB_META.map((entry) => [entry.tab, entry.label])
) as Record<SettingsTab, string>;

type SettingsSearchParams = Pick<URLSearchParams, "get" | "has">;

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

export function adjacentSettingsTab(
  tab: SettingsTab,
  direction: -1 | 1
): SettingsTab | null {
  const nextIndex = SETTINGS_TAB_ORDER.indexOf(tab) + direction;
  return nextIndex >= 0 ? (SETTINGS_TAB_ORDER[nextIndex] ?? null) : null;
}

export function settingsTabLabel(tab: SettingsTab): string {
  return SETTINGS_TAB_LABELS[tab];
}

// The document title for the whole settings area. Bare /settings is "Settings";
// an explicit tab is its own name; a Network section replaces the tab name, so
// the title reads "Content & media" while the URL still says Network.
export function settingsDocumentTitle(
  tab: SettingsTab,
  networkSection: string | null,
  hasExplicitTab = true
): string {
  const section = tab === "network" ? networkSection : null;
  if (section) {
    return `${sectionTitle(section)} - asocialmedia`;
  }
  if (!hasExplicitTab) {
    return "Settings - asocialmedia";
  }
  return `${settingsTabLabel(tab)} - asocialmedia`;
}

// Server-side counterpart for generateMetadata, which only has raw query values.
export function settingsTitleFromParams(
  tabValue: string | null,
  sectionValue: string | null
): string {
  const tab = getSettingsTab(
    new URLSearchParams(tabValue ? `tab=${tabValue}` : "")
  );
  const explicit = Boolean(tabValue);
  if (tab === "network" && sectionValue) {
    return settingsDocumentTitle(
      "network",
      isNetworkSubpageValue(sectionValue) ? sectionValue : null,
      explicit
    );
  }
  return settingsDocumentTitle(tab, null, explicit);
}

const SECTION_TITLES: Record<string, string> = {
  content: "Content & media",
  languages: "Languages",
  moderation: "Moderation & content filters",
  profiles: "Profiles",
};

function sectionTitle(section: string): string {
  return SECTION_TITLES[section] ?? settingsTabLabel("network");
}

// Kept local so this module stays free of the network subpage module (which
// pulls in icons and live-preferences helpers) for server-side metadata use.
function isNetworkSubpageValue(value: string): boolean {
  return value in SECTION_TITLES;
}
