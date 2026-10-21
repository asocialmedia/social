import { expect, test } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";

import { discoveryLocale } from "./discovery-locale";

test("discovery locale handles device, explicit, all and unsupported content languages", () => {
  const preferences = defaultNetworkPreferences();
  expect(
    discoveryLocale(
      { ...preferences, contentLanguages: ["ja"], region: "JP" },
      "en-US"
    )
  ).toBe("ja-JP");
  expect(
    discoveryLocale(
      { ...preferences, contentLanguages: [], language: "all" },
      "en-US"
    )
  ).toBe("all");
  expect(
    discoveryLocale(
      { ...preferences, contentLanguages: ["fi"], region: "FI" },
      "en-US"
    )
  ).toBe("all");
  expect(
    discoveryLocale(
      { ...preferences, contentLanguages: ["en"], region: "auto" },
      "en-IN"
    )
  ).toBe("en-IN");
});
