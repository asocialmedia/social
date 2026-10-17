import { expect, test } from "bun:test";

import { resolveDiscoveryLocale } from "./discovery-locale";

test("India's timezone supplies regional context without overriding English", () => {
  expect(resolveDiscoveryLocale(["en-US", "en"], "Asia/Calcutta")).toBe(
    "en-IN"
  );
  expect(resolveDiscoveryLocale(["en-GB"], "Asia/Kolkata")).toBe("en-IN");
  expect(resolveDiscoveryLocale(["hi-IN", "en-US"], "Asia/Kolkata", "en")).toBe(
    "en-IN"
  );
});

test("explicit all-languages preference and valid browser regions survive", () => {
  expect(resolveDiscoveryLocale(["en-US"], "Asia/Kolkata", "all")).toBe("all");
  expect(resolveDiscoveryLocale(["fr-CA"], "America/Toronto")).toBe("fr-CA");
  expect(resolveDiscoveryLocale(["invalid_value", "es-ES"], "UTC")).toBe(
    "es-ES"
  );
  expect(resolveDiscoveryLocale([], "UTC")).toBe("en");
});
