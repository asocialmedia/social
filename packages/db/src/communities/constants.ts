// Community taxonomy and presentation constants. Kept in @asm/db so the
// wizard, the discovery page, and server validation all read one source of
// truth. Topics are stored on the row as keys; labels and emoji are UI-only.

export interface CommunityTopic {
  emoji: string;
  key: string;
  label: string;
}

// The topic list a community can be filed under. Order is intentional: the
// wizard and discovery rails render it top to bottom.
export const COMMUNITY_TOPICS: readonly CommunityTopic[] = [
  { emoji: "🍣", key: "anime", label: "Anime & Cosplay" },
  { emoji: "🧑‍🎨", key: "art", label: "Art" },
  { emoji: "💵", key: "business", label: "Business & Finance" },
  { emoji: "🧩", key: "collectibles", label: "Collectibles & Other Hobbies" },
  { emoji: "🧑‍🏫", key: "education", label: "Education & Career" },
  { emoji: "🪞", key: "fashion", label: "Fashion & Beauty" },
  { emoji: "🍔", key: "food", label: "Food & Drinks" },
  { emoji: "🕹️", key: "games", label: "Games" },
  { emoji: "❤️‍🩹", key: "health", label: "Health" },
  { emoji: "🏡", key: "home", label: "Home & Garden" },
  { emoji: "📜", key: "humanities", label: "Humanities & Law" },
  { emoji: "🌈", key: "identity", label: "Identity & Relationships" },
  { emoji: "🙉", key: "internet", label: "Internet Culture" },
  { emoji: "🎞️", key: "movies", label: "Movies & TV" },
  { emoji: "🎶", key: "music", label: "Music" },
  { emoji: "🌿", key: "nature", label: "Nature & Outdoors" },
  { emoji: "📰", key: "news", label: "News & Politics" },
  { emoji: "🌐", key: "places", label: "Places & Travel" },
  { emoji: "✨", key: "popculture", label: "Pop Culture" },
  { emoji: "✏️", key: "qanda", label: "Q&As & Stories" },
  { emoji: "📖", key: "reading", label: "Reading & Writing" },
  { emoji: "🧪", key: "sciences", label: "Sciences" },
  { emoji: "💀", key: "spooky", label: "Spooky" },
  { emoji: "🏅", key: "sports", label: "Sports" },
  { emoji: "🛰️", key: "technology", label: "Technology" },
  { emoji: "🚗", key: "vehicles", label: "Vehicles" },
  { emoji: "🧘", key: "wellness", label: "Wellness" },
  { emoji: "🟥", key: "adult", label: "Adult Content" },
  { emoji: "🔞", key: "mature", label: "Mature Topics" },
] as const;

const TOPIC_BY_KEY = new Map(COMMUNITY_TOPICS.map((t) => [t.key, t]));

export function getCommunityTopic(key: string): CommunityTopic | undefined {
  return TOPIC_BY_KEY.get(key);
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

// Rolling window for the "weekly" visitor / contributor counts.
export const COMMUNITY_ACTIVITY_WINDOW_DAYS = 7;
