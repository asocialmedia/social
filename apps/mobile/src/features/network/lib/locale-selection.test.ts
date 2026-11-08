import { expect, test } from "bun:test";

import { contentRegionLabel, toggleContentLanguage } from "./locale-selection";

const regionName = (code: string) => {
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new RangeError("Invalid region");
  }
  return code === "IN" ? "India" : undefined;
};
test("the all-languages choice clears the filter rather than submitting a fake language code", () => {
  expect(toggleContentLanguage(["en", "hi"], "all")).toEqual([]);
  expect(toggleContentLanguage(["en"], "hi")).toEqual(["en", "hi"]);
  expect(toggleContentLanguage(["en", "hi"], "en")).toEqual(["hi"]);
});
test("device and global region choices never reach Intl.DisplayNames as invalid region codes", () => {
  expect(contentRegionLabel("auto", regionName)).toBe("Device region");
  expect(contentRegionLabel("all", regionName)).toBe("No regional preference");
  expect(contentRegionLabel("IN", regionName)).toBe("India");
});
