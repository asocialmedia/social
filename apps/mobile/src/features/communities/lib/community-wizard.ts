import {
  COMMUNITY_ACCENTS,
  COMMUNITY_TOPICS,
  emptyCommunityDraft,
  validateCommunityDraft,
  communitySlug,
} from "./community-create-contract";
import type { CommunityDraft } from "./community-create-contract";

export const COMMUNITY_CREATE_STEPS = [
  "Topics",
  "Access",
  "Details",
  "Accent",
  "Imagery",
] as const;
export interface CommunityWizardDraft extends CommunityDraft {
  avatarMediaId: string | null;
  bannerMediaId: string | null;
  slugTouched: boolean;
  step: number;
}
export function emptyCommunityWizard(): CommunityWizardDraft {
  return {
    ...emptyCommunityDraft(),
    avatarMediaId: null,
    bannerMediaId: null,
    slugTouched: false,
    step: 0,
  };
}
export function wizardSlug(draft: CommunityWizardDraft): string {
  return draft.slugTouched ? draft.slug : communitySlug(draft.name);
}
export function wizardStepValid(draft: CommunityWizardDraft): boolean {
  if (draft.step === 0) {
    return draft.topics.length > 0;
  }
  if (draft.step === 2) {
    return (
      validateCommunityDraft({ ...draft, slug: wizardSlug(draft) }) === null
    );
  }
  return true;
}
export function parseCommunityWizard(
  raw: unknown
): CommunityWizardDraft | null {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("name" in raw) ||
    typeof raw.name !== "string"
  ) {
    return null;
  }
  const value = raw as Partial<CommunityWizardDraft>;
  const initial = emptyCommunityWizard();
  return {
    ...initial,
    accentColor:
      value.accentColor && COMMUNITY_ACCENTS.includes(value.accentColor)
        ? value.accentColor
        : initial.accentColor,
    avatarMediaId:
      typeof value.avatarMediaId === "string" ? value.avatarMediaId : null,
    bannerMediaId:
      typeof value.bannerMediaId === "string" ? value.bannerMediaId : null,
    description: typeof value.description === "string" ? value.description : "",
    mature: value.mature === true,
    name: value.name ?? "",
    slug: typeof value.slug === "string" ? value.slug : "",
    slugTouched: value.slugTouched === true,
    step:
      typeof value.step === "number" && Number.isInteger(value.step)
        ? Math.min(4, Math.max(0, value.step))
        : 0,
    topics: Array.isArray(value.topics)
      ? [
          ...new Set(
            value.topics.filter((topic) => COMMUNITY_TOPICS.includes(topic))
          ),
        ].slice(0, 5)
      : [],
    type:
      value.type === "PRIVATE" || value.type === "RESTRICTED"
        ? value.type
        : "PUBLIC",
  };
}
