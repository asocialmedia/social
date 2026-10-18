import { expect, test } from "bun:test";

import {
  matchesAvoidedTopic,
  defaultNetworkPreferences,
  interestSchema,
  networkPreferencesSchema,
  networkPreferenceScope,
} from "./network-preferences";

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
