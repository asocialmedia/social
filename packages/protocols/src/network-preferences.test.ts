import { expect, test } from "bun:test";

import {
  matchesAvoidedTopic,
  defaultNetworkPreferences,
  interestSchema,
  networkPreferencesSchema,
  networkPreferenceScope,
} from "./network-preferences";

test("an exclusion for porn also covers pornography and pornographic compound tags", () => {
  expect(matchesAvoidedTopic("", ["pornography"], ["porn"])).toBe(true);
  expect(matchesAvoidedTopic("", ["pornographicart"], ["porn"])).toBe(true);
  expect(
    matchesAvoidedTopic("Software and web development", ["software"], ["porn"])
  ).toBe(false);
});

test("safe defaults and open vocabulary do not hardcode a persona taxonomy", () => {
  const preferences = defaultNetworkPreferences();
  expect(preferences.showExplicitContent).toBe(false);
  expect(interestSchema.parse(" #日本語 ")).toBe("日本語");
  expect(interestSchema.parse("  Quantum   optics ")).toBe("quantum optics");
  expect(interestSchema.parse("C++")).toBe("c++");
  expect(networkPreferencesSchema.parse(preferences)).toEqual(preferences);
  expect(interestSchema.safeParse("from:someone OR *").success).toBe(false);
});

test("profiles have unique names and identities, owned selection, and bounded settings", () => {
  const preferences = defaultNetworkPreferences();
  expect(
    networkPreferencesSchema.safeParse({
      ...preferences,
      activeProfileId: crypto.randomUUID(),
    }).success
  ).toBe(false);
  expect(
    networkPreferencesSchema.safeParse({
      ...preferences,
      profiles: [...preferences.profiles, ...preferences.profiles],
    }).success
  ).toBe(false);
  expect(
    networkPreferencesSchema.safeParse({ ...preferences, profiles: [] }).success
  ).toBe(false);
  expect(
    networkPreferencesSchema.safeParse({
      ...preferences,
      profiles: [
        {
          ...preferences.profiles[0],
          interests: Array.from(
            { length: 33 },
            (_, index) => `interest-${index}`
          ),
        },
      ],
    }).success
  ).toBe(false);
  expect(networkPreferenceScope({ preferences, revision: 2 })).not.toBe(
    networkPreferenceScope({ preferences, revision: 3 })
  );
});

test("old preferences gain empty exclusions without losing their interests", () => {
  const { avoidedTopics: _ignored, ...old } = defaultNetworkPreferences();
  expect(networkPreferencesSchema.parse(old).avoidedTopics).toEqual([]);
  expect(
    networkPreferencesSchema.parse({
      ...old,
      avoidedTopics: [" #Furry ", "furry"],
    }).avoidedTopics
  ).toEqual(["furry"]);
  expect(
    networkPreferencesSchema.safeParse({
      ...old,
      avoidedTopics: Array.from({ length: 65 }, (_, index) => `topic ${index}`),
    }).success
  ).toBe(false);
});

test("explicit avoidance matches topics and phrases without substring false positives", () => {
  expect(matchesAvoidedTopic("New furry artwork", [], ["furry"])).toBe(true);
  expect(matchesAvoidedTopic("A photograph", ["furry"], ["furry"])).toBe(true);
  expect(matchesAvoidedTopic("A new startup", [], ["art"])).toBe(false);
  expect(matchesAvoidedTopic("3D-art showcase", [], ["3d art"])).toBe(true);
  expect(matchesAvoidedTopic("C++ news", [], ["c++"])).toBe(true);
  expect(matchesAvoidedTopic("漫画", ["漫画"], ["漫画"])).toBe(true);
  expect(matchesAvoidedTopic("Anything", [], [])).toBe(false);
});

test("topic exclusions cover compound formats and plurals for an open vocabulary", () => {
  for (const tag of [
    "furryart",
    "FurryImages",
    "furryartist",
    "furrydrawings",
    "digitalfurryart",
    "nsfwfurry",
    "furries",
    "furry_art",
    "furry-art",
    "ＦｕｒｒｙＡｒｔ",
  ]) {
    expect(matchesAvoidedTopic("A new post", [tag], ["furry"])).toBe(true);
    expect(matchesAvoidedTopic(`#${tag}`, [], ["furry"])).toBe(true);
  }
  expect(matchesAvoidedTopic("New #astronomyphotos", [], ["astronomy"])).toBe(
    true
  );
  expect(
    matchesAvoidedTopic("A new post", ["digitalbotanyart"], ["botany"])
  ).toBe(true);
  expect(matchesAvoidedTopic("A new post", ["3dart"], ["3d art"])).toBe(true);
  expect(
    matchesAvoidedTopic(
      "A new post",
      ["sciencefictionart"],
      ["science fiction"]
    )
  ).toBe(true);
  expect(matchesAvoidedTopic("Digital furries drawing", [], ["furry"])).toBe(
    true
  );
});

test("compound matching keeps unrelated substrings and general co-occurrence visible", () => {
  for (const word of [
    "startup",
    "article",
    "artificial",
    "earth",
    "party",
    "cartoon",
  ]) {
    expect(matchesAvoidedTopic(word, [word], ["art"])).toBe(false);
  }
  expect(matchesAvoidedTopic("catastrophe", ["education"], ["cat"])).toBe(
    false
  );
  expect(
    matchesAvoidedTopic("Nature painting", ["art", "animals"], ["furry"])
  ).toBe(false);
  expect(
    matchesAvoidedTopic("An unrelated post", ["furry"], ["furryart"])
  ).toBe(false);
});

test("missing adult-content preferences default off and explicit opt-ins survive parsing", () => {
  const { showExplicitContent: _omitted, ...preferences } =
    defaultNetworkPreferences();
  const saved = { ...preferences, avoidedTopics: ["furry"] };
  expect(networkPreferencesSchema.parse(saved)).toMatchObject({
    avoidedTopics: ["furry"],
    showExplicitContent: false,
  });
  expect(
    networkPreferencesSchema.parse({ ...saved, showExplicitContent: true })
      .showExplicitContent
  ).toBe(true);
  expect(
    networkPreferencesSchema.safeParse({
      ...saved,
      showExplicitContent: "true",
    }).success
  ).toBe(false);
});
