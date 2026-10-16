import { expect, test } from "bun:test";

import type { CommunityWizardDraft } from "./community-wizard";
import {
  emptyCommunityWizard,
  parseCommunityWizard,
  wizardSlug,
  wizardStepValid,
} from "./community-wizard";

test("manually cleared addresses stay empty instead of silently reverting to the name", () => {
  const draft = { ...emptyCommunityWizard(), name: "Hackers" };
  expect(wizardSlug(draft)).toBe("hackers");
  expect(wizardSlug({ ...draft, slug: "", slugTouched: true })).toBe("");
  expect(wizardSlug({ ...draft, slug: "custom_name", slugTouched: true })).toBe(
    "custom_name"
  );
});
test("details validate the chosen address with the exact web schema", () => {
  const draft = {
    ...emptyCommunityWizard(),
    description: "A new space",
    name: "!!!",
    slug: "custom_name",
    slugTouched: true,
    step: 2,
    topics: ["art"] as const,
  };
  expect(wizardStepValid({ ...draft, topics: [...draft.topics] })).toBe(true);
  expect(
    wizardStepValid({
      ...draft,
      slug: "bad-address",
      topics: [...draft.topics],
    })
  ).toBe(false);
  expect(
    wizardStepValid({ ...draft, slug: "", topics: [...draft.topics] })
  ).toBe(false);
});
test("draft reload retains selections, imagery and step while rejecting stale or malformed values", () => {
  const draft: CommunityWizardDraft = {
    ...emptyCommunityWizard(),
    avatarMediaId: "avatar-id",
    bannerMediaId: "banner-id",
    name: "Hackers",
    slugTouched: true,
    step: 4,
    topics: ["art", "music"],
  };
  expect(parseCommunityWizard(structuredClone(draft))).toEqual(draft);
  expect(
    parseCommunityWizard({
      accentColor: "wrong",
      name: "Draft",
      step: 90,
      topics: ["art", "art", "unknown", null],
    })
  ).toMatchObject({ accentColor: "slate", step: 4, topics: ["art"] });
  expect(parseCommunityWizard(null)).toBeNull();
  expect(parseCommunityWizard({ name: 1 })).toBeNull();
});
