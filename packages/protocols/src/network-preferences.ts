import { z } from "zod";

export const NETWORK_LANGUAGES = [
  "ar",
  "bn",
  "de",
  "el",
  "en",
  "es",
  "fr",
  "hi",
  "id",
  "it",
  "ja",
  "ko",
  "mr",
  "nl",
  "pt",
  "ru",
  "sv",
  "ta",
  "te",
  "tr",
  "uk",
  "ur",
  "vi",
  "zh",
] as const;
export const INTEREST_SUGGESTIONS = [
  "anime",
  "manga",
  "comics",
  "gaming",
  "art",
  "3d art",
  "animation",
  "illustration",
  "figurines",
  "cosplay",
  "technology",
  "software",
  "programming",
  "open source",
  "web development",
  "artificial intelligence",
  "machine learning",
  "science",
  "astronomy",
  "space",
  "news",
  "politics",
  "history",
  "books",
  "music",
  "film",
  "photography",
  "design",
  "architecture",
  "fashion",
  "food",
  "cooking",
  "travel",
  "nature",
  "animals",
  "gardening",
  "sports",
  "fitness",
  "health",
  "education",
  "business",
  "finance",
  "climate",
  "crafts",
];

export function normalizeInterest(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/^#+/u, "")
    .replaceAll(/\s+/gu, " ");
}

export const interestSchema = z
  .string()
  .transform(normalizeInterest)
  .pipe(
    z
      .string()
      .min(2)
      .max(64)
      .regex(/^[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M} .+#_-]*$/u)
  );
export const networkProfileSchema = z.object({
  id: z
    .string()
    .regex(/^(?:default|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i),
  interests: z
    .array(interestSchema)
    .max(32)
    .transform((values) => [...new Set(values)]),
  name: z.string().trim().min(1).max(40),
});
export const networkPreferencesSchema = z
  .object({
    activeProfileId: networkProfileSchema.shape.id,
    avoidedTopics: z
      .array(interestSchema)
      .max(64)
      .transform((values) => [...new Set(values)])
      .default([]),
    language: z.enum(["auto", "all", ...NETWORK_LANGUAGES]),
    profiles: z.array(networkProfileSchema).min(1).max(8),
    region: z.string().regex(/^(?:auto|all|[A-Z]{2})$/),
    showExplicitContent: z.boolean(),
  })
  .superRefine((value, context) => {
    if (
      !value.profiles.some((profile) => profile.id === value.activeProfileId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Choose a profile belonging to this account",
      });
    }
    if (
      new Set(value.profiles.map((profile) => profile.id)).size !==
        value.profiles.length ||
      new Set(value.profiles.map((profile) => profile.name.toLowerCase()))
        .size !== value.profiles.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Profile names and identifiers must be unique",
      });
    }
  });
export type NetworkPreferences = z.infer<typeof networkPreferencesSchema>;
export type NetworkProfile = z.infer<typeof networkProfileSchema>;

export function defaultNetworkPreferences(): NetworkPreferences {
  return {
    activeProfileId: "default",
    avoidedTopics: [],
    language: "auto",
    profiles: [{ id: "default", interests: [], name: "Everyday" }],
    region: "auto",
    showExplicitContent: false,
  };
}

export interface NetworkSettings {
  catalog: string[];
  persona: {
    avoidedTopics: string[];
    relatedInterests: string[];
    learnedInterests: string[];
    signalCount: number;
  };
  preferences: NetworkPreferences;
  revision: number;
}

export const networkPreferencesUpdateSchema = z.object({
  preferences: networkPreferencesSchema,
  revision: z.number().int().nonnegative(),
});

export function networkPreferenceScope(
  settings: Pick<NetworkSettings, "preferences" | "revision">
): string {
  return `${settings.preferences.activeProfileId}:${settings.revision}`;
}

// Match whole topics and phrases, so avoiding art does not also hide a startup.
export function matchesAvoidedTopic(
  text: string,
  topics: readonly string[],
  avoided: readonly string[]
): boolean {
  const normalize = (value: string) =>
    normalizeInterest(value).replaceAll(/[-_]+/gu, " ");
  const content = normalize(text);
  const declared = new Set(topics.map(normalize));
  return avoided.some((raw) => {
    const topic = normalize(raw);
    if (!topic) {
      return false;
    }
    const escaped = topic.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return (
      declared.has(topic) ||
      new RegExp(
        `(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`,
        "u"
      ).test(content)
    );
  });
}
