import type { NetworkPreferences } from "@asm/protocols/discovery";
import { NETWORK_LANGUAGES } from "@asm/protocols/discovery";
import type { LucideIcon } from "lucide-react";
import { Brain, Globe, Shield, Sparkles } from "lucide-react";

export type NetworkSubpage =
  | "profiles"
  | "content"
  | "moderation"
  | "languages";

interface NetworkSubpageEntry {
  description: string;
  icon: LucideIcon;
  id: NetworkSubpage;
  title: string;
}

export const NETWORK_SUBPAGES: readonly NetworkSubpageEntry[] = [
  {
    description: "Switch the lens your feeds are discovered through.",
    icon: Brain,
    id: "profiles",
    title: "Profiles",
  },
  {
    description: "What this profile is into, and what it learns as you browse.",
    icon: Sparkles,
    id: "content",
    title: "Content & media",
  },
  {
    description: "Sensitive media, and the topics you would rather not see.",
    icon: Shield,
    id: "moderation",
    title: "Moderation & content filters",
  },
  {
    description: "The languages and region your discovery prefers.",
    icon: Globe,
    id: "languages",
    title: "Languages",
  },
];

const SECTION_TARGETS: Record<string, NetworkSubpage> = {
  "settings-network-avoid": "moderation",
  "settings-network-explicit": "moderation",
  "settings-network-interests": "content",
  "settings-network-profiles": "profiles",
  "settings-network-region": "languages",
};

export function networkSubpageForSection(
  sectionId: string
): NetworkSubpage | null {
  return SECTION_TARGETS[sectionId] ?? null;
}

export function networkSubpageEntry(
  subpage: NetworkSubpage
): NetworkSubpageEntry {
  return (
    NETWORK_SUBPAGES.find((entry) => entry.id === subpage) ??
    NETWORK_SUBPAGES[0]
  );
}

// One line under each hub entry, read from the live preferences so the hub is a
// real dashboard rather than a menu of unknown doors.
export function networkSubpageSummary(
  subpage: NetworkSubpage,
  preferences: NetworkPreferences,
  activeProfileName: string
): string {
  switch (subpage) {
    case "profiles": {
      const total = preferences.profiles.length;
      return `${total === 1 ? "1 profile" : `${total} profiles`} · ${activeProfileName} active`;
    }
    case "content": {
      const interests = preferences.profiles.find(
        (profile) => profile.id === preferences.activeProfileId
      );
      return `${interests?.interests.length ?? 0} of 32 interests`;
    }
    case "moderation": {
      const count = preferences.avoidedTopics.length;
      return `${preferences.showExplicitContent ? "18+ shown" : "18+ hidden"} · ${count} ${count === 1 ? "topic" : "topics"} avoided`;
    }
    case "languages": {
      return `${describeLanguage(preferences.language)} · ${describeRegion(preferences.region)}`;
    }
    default: {
      return "";
    }
  }
}

export function describeLanguage(value: string): string {
  if (value === "auto") {
    return "Device language";
  }
  if (value === "all") {
    return "All languages";
  }
  if (!NETWORK_LANGUAGES.some((language) => language === value)) {
    return value;
  }
  return new Intl.DisplayNames(["en"], { type: "language" }).of(value) ?? value;
}

export function describeRegion(value: string): string {
  if (value === "auto") {
    return "Device region";
  }
  if (value === "all") {
    return "No region";
  }
  return new Intl.DisplayNames(["en"], { type: "region" }).of(value) ?? value;
}

// Which subpage is open lives here rather than inside the component: the
// settings search has to open a subpage in a tab that has not mounted yet, and
// the choice survives leaving and returning to settings.
let requested: NetworkSubpage | null = null;
const listeners = new Set<() => void>();

export function requestNetworkSubpage(subpage: NetworkSubpage | null) {
  if (requested === subpage) {
    return;
  }
  requested = subpage;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeNetworkSubpage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readRequestedNetworkSubpage(): NetworkSubpage | null {
  return requested;
}
