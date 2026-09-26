// The community creation contract, mirrored from @asm/auth's
// createCommunitySchema so the wizard can validate before it spends a round
// trip. The keys are duplicated rather than imported because the mobile app
// cannot pull the server validation bundle into the React Native runtime, and
// a stale list here would offer a topic the server then rejects.
//
// The server remains the authority: createCommunitySchema re-validates
// everything, so a mistake in this mirror surfaces as the server's message
// rather than as bad data.

import {
  COMMUNITY_ACCENT_KEYS,
  COMMUNITY_TOPIC_KEYS,
} from "@asm/auth/validation";

export const COMMUNITY_ACCENTS = COMMUNITY_ACCENT_KEYS;
export const COMMUNITY_TOPICS = COMMUNITY_TOPIC_KEYS;

export type CommunityAccent = (typeof COMMUNITY_ACCENTS)[number];
export type CommunityTopic = (typeof COMMUNITY_TOPICS)[number];
export type CommunityType = "PRIVATE" | "PUBLIC" | "RESTRICTED";

export const COMMUNITY_LIMITS = {
  descriptionMax: 500,
  nameMax: 21,
  nameMin: 3,
  slugMax: 21,
  slugMin: 3,
  topicsMax: 5,
  topicsMin: 1,
} as const;

export const COMMUNITY_TYPE_META: readonly {
  description: string;
  label: string;
  value: CommunityType;
}[] = [
  {
    description: "Anyone can view, post, and comment",
    label: "Public",
    value: "PUBLIC",
  },
  {
    description: "Anyone can view, approved people can post",
    label: "Restricted",
    value: "RESTRICTED",
  },
  {
    description: "Only members can see it at all",
    label: "Private",
    value: "PRIVATE",
  },
];

/** The community's own address, or null while the name cannot make one. */
export function communitySlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  if (
    slug.length < COMMUNITY_LIMITS.slugMin ||
    slug.length > COMMUNITY_LIMITS.slugMax
  ) {
    return "";
  }
  return slug;
}

export interface CommunityDraft {
  accentColor: CommunityAccent;
  description: string;
  mature: boolean;
  name: string;
  slug: string;
  topics: CommunityTopic[];
  type: CommunityType;
}

export function emptyCommunityDraft(): CommunityDraft {
  return {
    accentColor: "slate",
    description: "",
    mature: false,
    name: "",
    slug: "",
    topics: [],
    type: "PUBLIC",
  };
}

/** The first problem with a draft, or null when it would pass the server. */
export function validateCommunityDraft(draft: CommunityDraft): string | null {
  const name = draft.name.trim();
  if (name.length < COMMUNITY_LIMITS.nameMin) {
    return "Community name must be at least 3 characters";
  }
  if (name.length > COMMUNITY_LIMITS.nameMax) {
    return "Community name must be at most 21 characters";
  }
  const description = draft.description.trim();
  if (!description) {
    return "Add a description so people know what this is about";
  }
  if (description.length > COMMUNITY_LIMITS.descriptionMax) {
    return "Description must be at most 500 characters";
  }
  if (!draft.slug) {
    return "Community address must be 3 to 21 letters, numbers, or underscores";
  }
  if (draft.topics.length < COMMUNITY_LIMITS.topicsMin) {
    return "Pick at least one topic";
  }
  if (draft.topics.length > COMMUNITY_LIMITS.topicsMax) {
    return "Pick at most 5 topics";
  }
  return null;
}

/** Whether a topic can still be added, so the picker can disable the rest. */
export function canAddTopic(
  topics: readonly CommunityTopic[],
  topic: CommunityTopic
): boolean {
  if (topics.includes(topic)) {
    return true;
  }
  return topics.length < COMMUNITY_LIMITS.topicsMax;
}
