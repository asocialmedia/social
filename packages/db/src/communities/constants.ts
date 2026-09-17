// Community taxonomy and presentation constants. Kept in @asm/db so the
// wizard, the discovery page, and server validation all read one source of
// truth. Topics are stored on the row as keys; labels are UI-only.

export interface CommunityTopic {
  key: string;
  label: string;
}

// The topic list a community can be filed under. Order is intentional: the
// wizard and discovery rails render it top to bottom.
export const COMMUNITY_TOPICS: readonly CommunityTopic[] = [
  { key: "anime", label: "Anime & Cosplay" },
  { key: "art", label: "Art" },
  { key: "business", label: "Business & Finance" },
  { key: "collectibles", label: "Collectibles & Other Hobbies" },
  { key: "education", label: "Education & Career" },
  { key: "fashion", label: "Fashion & Beauty" },
  { key: "food", label: "Food & Drinks" },
  { key: "games", label: "Games" },
  { key: "health", label: "Health" },
  { key: "home", label: "Home & Garden" },
  { key: "humanities", label: "Humanities & Law" },
  { key: "identity", label: "Identity & Relationships" },
  { key: "internet", label: "Internet Culture" },
  { key: "movies", label: "Movies & TV" },
  { key: "music", label: "Music" },
  { key: "nature", label: "Nature & Outdoors" },
  { key: "news", label: "News & Politics" },
  { key: "places", label: "Places & Travel" },
  { key: "popculture", label: "Pop Culture" },
  { key: "qanda", label: "Q&As & Stories" },
  { key: "reading", label: "Reading & Writing" },
  { key: "sciences", label: "Sciences" },
  { key: "spooky", label: "Spooky" },
  { key: "sports", label: "Sports" },
  { key: "technology", label: "Technology" },
  { key: "vehicles", label: "Vehicles" },
  { key: "wellness", label: "Wellness" },
  { key: "adult", label: "Adult Content" },
  { key: "mature", label: "Mature Topics" },
] as const;

const TOPIC_BY_KEY = new Map(COMMUNITY_TOPICS.map((t) => [t.key, t]));

export function getCommunityTopic(key: string): CommunityTopic | undefined {
  return TOPIC_BY_KEY.get(key);
}

// The generalized browse categories shown as the single filter row on the
// discovery page. Each rolls several fine-grained topics up into one
// Discord-style shelf so the filter row stays a handful of items instead of
// the full 29-topic taxonomy. `topics` empty means "All" (no filter).
export interface CommunityCategory {
  key: string;
  label: string;
  // Hidden from the discovery filter row but still a real category: it keeps
  // anchoring its topics for coverage/counting without being offered as a
  // browsable shelf. Used for adult content, which is opted into by topic
  // rather than advertised on the main directory.
  hidden?: boolean;
  topics: readonly string[];
}

// Order is intentional: the discovery filter row renders it left to right.
// Every COMMUNITY_TOPICS key must appear in exactly one non-"all" category;
// the coverage test in constants.test.ts enforces it.
export const COMMUNITY_CATEGORIES: readonly CommunityCategory[] = [
  { key: "all", label: "All", topics: [] },
  { key: "gaming", label: "Gaming", topics: ["games"] },
  {
    key: "entertainment",
    label: "Entertainment",
    topics: ["anime", "movies", "popculture", "spooky"],
  },
  { key: "music", label: "Music", topics: ["music"] },
  {
    key: "education",
    label: "Education",
    topics: ["education", "reading", "humanities", "qanda"],
  },
  {
    key: "science-tech",
    label: "Science & Tech",
    topics: ["technology", "sciences"],
  },
  { key: "art", label: "Art & Design", topics: ["art", "fashion"] },
  {
    key: "lifestyle",
    label: "Lifestyle",
    topics: [
      "collectibles",
      "food",
      "health",
      "home",
      "nature",
      "vehicles",
      "wellness",
    ],
  },
  { key: "sports", label: "Sports", topics: ["sports"] },
  {
    key: "society",
    label: "Society",
    topics: ["business", "identity", "internet", "news", "places"],
  },
  {
    hidden: true,
    key: "adult",
    label: "Adult (18+)",
    topics: ["adult", "mature"],
  },
] as const;

// What the discovery filter row actually renders. Hidden categories stay in
// COMMUNITY_CATEGORIES so their topics remain covered and counted, but are not
// offered as a browsable shelf on the main directory.
export const COMMUNITY_DISCOVERY_CATEGORIES: readonly CommunityCategory[] =
  COMMUNITY_CATEGORIES.filter((category) => !category.hidden);

const CATEGORY_BY_KEY = new Map(COMMUNITY_CATEGORIES.map((c) => [c.key, c]));

export const DEFAULT_COMMUNITY_CATEGORY = "all";

export function getCommunityCategory(
  key: string
): CommunityCategory | undefined {
  return CATEGORY_BY_KEY.get(key);
}

export function isCommunityCategory(key: string): boolean {
  return CATEGORY_BY_KEY.has(key);
}

// Tonal accent palette. Each key resolves to a considered pair of values: a
// deep, desaturated tone for light mode and a lifted one for dark mode, so the
// post-card rail and header always clear their surface. Deliberately no
// saturated poster colors and no blue-to-purple pairing.
export interface CommunityAccent {
  dark: string;
  key: string;
  label: string;
  light: string;
}

export const COMMUNITY_ACCENTS: readonly CommunityAccent[] = [
  { dark: "#fb923c", key: "ember", label: "Ember", light: "#c2410c" },
  { dark: "#f87171", key: "clay", label: "Clay", light: "#b91c1c" },
  { dark: "#fbbf24", key: "sand", label: "Sand", light: "#a16207" },
  { dark: "#a3e635", key: "moss", label: "Moss", light: "#4d7c0f" },
  { dark: "#34d399", key: "pine", label: "Pine", light: "#047857" },
  { dark: "#2dd4bf", key: "ocean", label: "Ocean", light: "#0f766e" },
  { dark: "#60a5fa", key: "denim", label: "Denim", light: "#1d4ed8" },
  { dark: "#818cf8", key: "iris", label: "Iris", light: "#4338ca" },
  { dark: "#c084fc", key: "plum", label: "Plum", light: "#7e22ce" },
  { dark: "#f472b6", key: "rose", label: "Rose", light: "#be185d" },
  { dark: "#a8a29e", key: "stone", label: "Stone", light: "#57534e" },
  { dark: "#94a3b8", key: "slate", label: "Slate", light: "#334155" },
] as const;

const ACCENT_BY_KEY = new Map(COMMUNITY_ACCENTS.map((a) => [a.key, a]));

export const DEFAULT_COMMUNITY_ACCENT = "slate";

export function getCommunityAccent(key: string): CommunityAccent {
  return (
    ACCENT_BY_KEY.get(key) ??
    (ACCENT_BY_KEY.get(DEFAULT_COMMUNITY_ACCENT) as CommunityAccent)
  );
}

export function isCommunityAccent(key: string): boolean {
  return ACCENT_BY_KEY.has(key);
}

// Hard limits mirrored by the wizard and the server validator.
export const COMMUNITY_LIMITS = {
  descriptionMax: 500,
  nameMax: 21,
  nameMin: 3,
  slugMax: 21,
  slugMin: 3,
  topicMax: 5,
} as const;

// Founding is earned, not free. The Nth community an account creates requires
// this much standing; index 0 is the first community. The array length is also
// the hard cap on how many communities one account may ever own, so the two
// rules can never drift apart.
//
// Shape: a steep early ladder (1k, 5k, 10k, 15k) that rewards getting started,
// then a steady 5k step to 40k, then a deliberate 10k jump to the 50k ceiling.
// The two named milestones the product commits to are index 5 (6 communities
// at 25k) and index 9 (the 10-community cap at 50k).
export const COMMUNITY_CREATION_AURA_TIERS = [
  1000, 5000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000, 50_000,
] as const;

export const COMMUNITY_MAX_OWNED = COMMUNITY_CREATION_AURA_TIERS.length;

// Aura required to found the community at `ownedCount` (0-based). Returns null
// once the account is at the cap, where no further creation is possible.
export function communityCreationAuraRequirement(
  ownedCount: number
): number | null {
  return COMMUNITY_CREATION_AURA_TIERS[ownedCount] ?? null;
}

// Escalating one-time bonus paid to the founder, keyed by how many communities
// they already owned (index 0 = their first). A reward for building more of the
// platform, deliberately superlinear, and capped flat once past the fifth so
// the tail does not explode.
//
// This is a REWARD, not a credential. It is excluded from standing (see
// STANDING_EXCLUDED_TYPES in aura/config) precisely so it cannot self-fund the
// next bar: by the sixth community the account would otherwise have banked
// 18,500 of the 25,000 bar purely from founding. Excluded, the bonus lands in
// aura - visible, rankable, and paying into the flame - while each next bar
// still demands real outside contribution.
//
// Parallel to COMMUNITY_CREATION_AURA_TIERS, but they measure different things:
// the tier is the standing BAR to found the Nth community, this is the aura
// REWARD for having founded it.
export const COMMUNITY_FOUNDING_BONUSES = [
  500, 1000, 2000, 5000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000,
] as const;

// The bonus for founding the community at `ownedCount` (0-based). Zero once
// past the table, which the ownership cap makes unreachable anyway.
export function communityFoundingBonus(ownedCount: number): number {
  return COMMUNITY_FOUNDING_BONUSES[ownedCount] ?? 0;
}

// Rolling window for the "weekly" visitor / contributor counts.
export const COMMUNITY_ACTIVITY_WINDOW_DAYS = 7;

// A community counts as "new" for the growing rail inside this window.
export const COMMUNITY_GROWING_WINDOW_DAYS = 30;
