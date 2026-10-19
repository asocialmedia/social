import { z } from "zod";

import type { NetworkPreferences } from "./network-preferences";

export const networkTopicSchema = z.object({
  aliases: z.array(z.string().max(128)).max(16).default([]),
  description: z.string().max(1000).optional(),
  id: z.string().max(256),
  label: z.string().min(2).max(128),
  source: z.enum(["wikimedia", "asm", "observed"]),
});
export type NetworkTopic = z.infer<typeof networkTopicSchema>;

export const networkTopicPageSchema = z.object({
  aliases: z.array(z.string().max(128)).max(16).default([]),
  items: z.array(networkTopicSchema).max(40),
  parent: z.string().max(128).nullable(),
  partial: z.boolean().default(false),
  relatedTerms: z.array(z.string().max(128)).max(200).optional(),
  requiresContext: z.boolean().optional(),
});
export type NetworkTopicPage = z.infer<typeof networkTopicPageSchema>;

export interface NetworkTopicScope {
  aliases?: Record<string, string[]>;
  avoided: Record<string, string[]>;
  interests: Record<string, string[]>;
  related?: Record<string, string[]>;
  qualifiers?: Record<string, string[]>;
  version: string;
}

export function scopedNetworkPreferences<
  T extends Pick<NetworkPreferences, "avoidedTopics">,
>(preferences: T, scope?: NetworkTopicScope): T {
  return {
    ...preferences,
    avoidedTopics: [
      ...new Set(
        preferences.avoidedTopics.flatMap(
          (root) => scope?.avoided[root] ?? [root]
        )
      ),
    ],
  };
}
