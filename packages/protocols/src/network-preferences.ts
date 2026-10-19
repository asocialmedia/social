import { z } from "zod";

import type { NetworkTopicScope } from "./network-topics";

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

export function normalizeInterest(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/^#+/u, "")
    .replaceAll(/\s+/gu, " ");
}

export function detectRegionalLanguage(
  languages?: readonly string[]
): string | null {
  if (languages?.length) {
    for (const lang of languages) {
      const code = lang.split("-")[0]?.toLowerCase();
      if (code && code !== "en") {
        return code;
      }
    }
  }
  if (typeof navigator !== "undefined") {
    const navLangs = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
    for (const lang of navLangs) {
      if (!lang) {
        continue;
      }
      const code = lang.split("-")[0]?.toLowerCase();
      if (code && code !== "en") {
        return code;
      }
    }
  }
  return null;
}

export function defaultContentLanguages(
  regionalLang?: string | null
): string[] {
  const regional = regionalLang ?? detectRegionalLanguage();
  if (regional && regional !== "en") {
    return ["en", regional];
  }
  return ["en"];
}

export const interestSchema = z
  .string()
  .transform(normalizeInterest)
  .pipe(
    z
      .string()
      .min(2)
      .max(64)
      .regex(/^[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M} .+#_&()'’:,;!?/-]*$/u)
  );
export const networkProfileSchema = z.object({
  activityResetAt: z.number().int().nonnegative().optional(),
  id: z
    .string()
    .regex(/^(?:default|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i),
  interests: z
    .array(interestSchema)
    .max(32)
    .transform((values) => [...new Set(values)]),
  name: z.string().trim().min(1).max(40),
});
function resolveContentLanguages(
  contentLanguages?: string[],
  language = "auto"
): string[] {
  if (contentLanguages) {
    return contentLanguages;
  }
  if (language === "all") {
    return [];
  }
  if (language !== "auto" && language !== "en") {
    return ["en", language];
  }
  return ["en"];
}

export const networkPreferencesSchema = z
  .object({
    activeProfileId: networkProfileSchema.shape.id,
    avoidedTopics: z
      .array(interestSchema)
      .max(64)
      .transform((values) => [...new Set(values)])
      .default([]),
    contentLanguages: z
      .array(z.string().min(2).max(10))
      .transform((values) => [...new Set(values)])
      .optional(),
    language: z.enum(["auto", "all", ...NETWORK_LANGUAGES]).default("auto"),
    profiles: z.array(networkProfileSchema).min(1).max(8),
    region: z.string().regex(/^(?:auto|all|[A-Z]{2})$/),
    showExplicitContent: z.boolean().default(false),
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
  })
  .transform((data) => ({
    ...data,
    contentLanguages: resolveContentLanguages(
      data.contentLanguages,
      data.language
    ),
  }));
export type NetworkPreferences = z.infer<typeof networkPreferencesSchema>;
export type NetworkProfile = z.infer<typeof networkProfileSchema>;

export function defaultNetworkPreferences(
  regionalLang?: string | null
): NetworkPreferences {
  return {
    activeProfileId: "default",
    avoidedTopics: [],
    contentLanguages: defaultContentLanguages(regionalLang),
    language: "auto",
    profiles: [{ id: "default", interests: [], name: "Everyday" }],
    region: "auto",
    showExplicitContent: false,
  };
}

export interface NetworkSettings {
  catalog: string[];
  topicScope?: NetworkTopicScope;
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
  settings: Pick<NetworkSettings, "preferences" | "revision" | "topicScope">
): string {
  return `v6:${settings.preferences.activeProfileId}:${settings.revision}:${settings.topicScope?.version ?? "exact"}`;
}

// Unicode word boundaries handle prose. Compound metadata can surround a longer
// chosen token with additional words; short roots remain exact to avoid substring noise.
function compoundTopicMatches(candidate: string, topic: string): boolean {
  const forms = [topic, `${topic}s`, `${topic}es`];
  if (/[^aeiou]y$/u.test(topic)) {
    forms.push(`${topic.slice(0, -1)}ies`);
  }
  return forms.some((form) => {
    if (candidate === form) {
      return true;
    }
    if (topic.length < 4) {
      return false;
    }
    const start = candidate.indexOf(form);
    if (start === -1) {
      return false;
    }
    const prefix = start;
    const suffix = candidate.length - start - form.length;
    return (prefix === 0 || prefix >= 3) && (suffix === 0 || suffix >= 3);
  });
}

// Whole words cover prose; compound tags preserve the topic while changing its
// format. Co-occurrence alone is not a synonym and must not block unrelated art.
export function matchesAvoidedTopic(
  text: string,
  topics: readonly string[],
  avoided: readonly string[]
): boolean {
  if (!avoided.length) {
    return false;
  }
  const normalize = (value: string) =>
    normalizeInterest(value).replaceAll(/[-_]+/gu, " ");
  const content = normalize(text);
  const declared = new Set(topics.map(normalize));
  const candidates = [
    ...new Set(
      [...declared, ...(content.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [])].map(
        (value) => value.replaceAll(/\s+/gu, "")
      )
    ),
  ].filter((value) => value.length >= 2 && value.length <= 128);
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
      ).test(content) ||
      candidates.some((candidate) =>
        compoundTopicMatches(candidate, topic.replaceAll(/\s+/gu, ""))
      )
    );
  });
}
