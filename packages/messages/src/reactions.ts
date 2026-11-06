export const QUICK_MESSAGE_REACTIONS = ["❤️", "👍", "😂", "😮", "😢"] as const;

export const REACTION_CATEGORIES = [
  { id: 0, label: "Smileys" },
  { id: 1, label: "People" },
  { id: 3, label: "Nature" },
  { id: 4, label: "Food" },
  { id: 5, label: "Travel" },
  { id: 6, label: "Activities" },
  { id: 7, label: "Objects" },
  { id: 8, label: "Symbols" },
  { id: 9, label: "Flags" },
] as const;

export const REACTION_SKIN_TONES = [
  "Default",
  "Light",
  "Medium-light",
  "Medium",
  "Medium-dark",
  "Dark",
] as const;

export interface ReactionEmoji {
  emoji: string;
  label: string;
  group: number;
  search: string;
  variants: readonly { emoji: string; label: string }[];
}

export interface ReactionCatalog {
  emojis: readonly ReactionEmoji[];
  allowed: ReadonlySet<string>;
}

let catalogPromise: Promise<ReactionCatalog> | undefined;

// Keep the Unicode dataset out of the transcript's initial bundle.
export function loadReactionCatalog(): Promise<ReactionCatalog> {
  catalogPromise ??= readReactionCatalog();
  return catalogPromise;
}

async function readReactionCatalog(): Promise<ReactionCatalog> {
  try {
    const { default: data } = await import("emojibase-data/en/compact.json");
    const emojis: ReactionEmoji[] = [];
    const allowed = new Set<string>();
    for (const entry of data) {
      if (entry.group === undefined || entry.group === 2) {
        continue;
      }
      const variants = (entry.skins ?? []).map((skin) => ({
        emoji: skin.unicode,
        label: skin.label,
      }));
      allowed.add(entry.unicode);
      for (const variant of variants) {
        allowed.add(variant.emoji);
      }
      emojis.push({
        emoji: entry.unicode,
        group: entry.group,
        label: entry.label,
        search: normalizeEmojiSearch(
          [entry.label, ...(entry.tags ?? [])].join(" ")
        ),
        variants,
      });
    }
    return { allowed, emojis };
  } catch (error) {
    catalogPromise = undefined;
    throw error;
  }
}

function normalizeEmojiSearch(value: string): string {
  return value.toLowerCase().replaceAll(/[:_-]/gu, " ").trim();
}

export function searchReactionEmojis(
  catalog: ReactionCatalog,
  query: string,
  group: number,
  tone = 0
): readonly ReactionEmoji[] {
  const tokens = normalizeEmojiSearch(query).split(/\s+/u).filter(Boolean);
  return catalog.emojis.flatMap((entry) => {
    const exactVariant = entry.variants.find(
      (variant) => variant.emoji === query.trim()
    );
    if (tokens.length > 0) {
      if (
        !exactVariant &&
        entry.emoji !== query.trim() &&
        !tokens.every((token) => entry.search.includes(token))
      ) {
        return [];
      }
    } else if (entry.group !== group) {
      return [];
    }
    const variant = exactVariant ?? entry.variants[tone - 1];
    return [
      variant
        ? { ...entry, emoji: variant.emoji, label: variant.label }
        : entry,
    ];
  });
}
