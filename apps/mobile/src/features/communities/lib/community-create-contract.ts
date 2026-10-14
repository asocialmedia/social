import {
  createCommunitySchema,
  COMMUNITY_ACCENT_KEYS,
  COMMUNITY_TOPIC_KEYS,
} from "@asm/auth/validation";
// The native wizard uses the same schema and slug rules as web.
import { slugifyCommunityName } from "@asm/db/communities";

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
    description: "Anyone can view, only approved users can post",
    label: "Restricted",
    value: "RESTRICTED",
  },
  {
    description: "Only approved users can view and post",
    label: "Private",
    value: "PRIVATE",
  },
];

// The community's own address, or null while the name cannot make one.
export function communitySlug(name: string): string {
  const slug = slugifyCommunityName(name);
  return slug.length >= COMMUNITY_LIMITS.slugMin &&
    name.trim().length <= COMMUNITY_LIMITS.nameMax
    ? slug
    : "";
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

// The first problem with a draft, or null when it would pass the server.
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
  if (!/^[a-z0-9_]{3,21}$/.test(draft.slug.trim())) {
    return "Community address must be 3 to 21 lowercase letters, numbers, or underscores";
  }
  if (draft.topics.length < COMMUNITY_LIMITS.topicsMin) {
    return "Pick at least one topic";
  }
  if (draft.topics.length > COMMUNITY_LIMITS.topicsMax) {
    return "Pick at most 5 topics";
  }
  const parsed = createCommunitySchema.safeParse(draft);
  return parsed.success
    ? null
    : (parsed.error.issues[0]?.message ?? "Check your community details");
}

// Whether a topic can still be added, so the picker can disable the rest.
export function canAddTopic(
  topics: readonly CommunityTopic[],
  topic: CommunityTopic
): boolean {
  if (topics.includes(topic)) {
    return true;
  }
  return topics.length < COMMUNITY_LIMITS.topicsMax;
}
