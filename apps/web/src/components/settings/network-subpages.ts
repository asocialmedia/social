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

const SUBPAGE_IDS = new Set<string>(NETWORK_SUBPAGES.map((entry) => entry.id));

const SECTION_TARGETS: Record<string, NetworkSubpage> = {
  "settings-network-activity": "content",
  "settings-network-avoid": "moderation",
  "settings-network-connections": "content",
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

// The URL holds which subpage is open (?section=content), so a refresh lands on
// the same page and Back returns to the hub instead of leaving Settings. The
// visible title is the section's own name.
export function isNetworkSubpage(value: string): value is NetworkSubpage {
  return SUBPAGE_IDS.has(value);
}

export function getNetworkSubpage(
  searchParams: Pick<URLSearchParams, "get">
): NetworkSubpage | null {
  const requested = searchParams.get("section");
  return requested && isNetworkSubpage(requested) ? requested : null;
}

export function networkSubpageTitle(subpage: NetworkSubpage): string {
  return networkSubpageEntry(subpage).title;
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
      const langs = preferences.contentLanguages;
      let langSummary = describeLanguage(preferences.language);
      if (preferences.language !== "auto" && langs !== undefined) {
        if (langs.length === 0) {
          langSummary = "All languages";
        } else if (langs.length === 1 && langs[0]) {
          langSummary = describeLanguageCode(langs[0]);
        } else if (langs.length === 2 && langs[0] && langs[1]) {
          langSummary = `${describeLanguageCode(langs[0])}, ${describeLanguageCode(langs[1])}`;
        } else if (langs[0]) {
          langSummary = `${describeLanguageCode(langs[0])} + ${langs.length - 1} more`;
        }
      }
      return `${langSummary} · ${describeRegion(preferences.region)}`;
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

export function describeLanguageCode(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
