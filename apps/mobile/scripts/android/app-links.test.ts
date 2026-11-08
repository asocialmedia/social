import { describe, expect, test } from "bun:test";

import assetLinks from "../../../web/public/.well-known/assetlinks.json";
import appJson from "../../app.json";

const filters = appJson.expo.android.intentFilters;

function manifestHandles(value: string) {
  const url = new URL(value);
  return filters.some((filter) =>
    filter.data.some((data) => {
      if (`${data.scheme}:` !== url.protocol || data.host !== url.hostname) {
        return false;
      }
      return "path" in data
        ? url.pathname === data.path
        : url.pathname.startsWith(data.pathPrefix);
    })
  );
}

function dynamicRulesAllow(value: string) {
  const { pathname } = new URL(value);
  const rules =
    assetLinks[0].relation_extensions[
      "delegate_permission/common.handle_all_urls"
    ].dynamic_app_link_components;
  const rule = rules.find((candidate) => {
    const pattern = candidate["/"];
    return pattern.endsWith("*")
      ? pathname.startsWith(pattern.slice(0, -1))
      : pathname === pattern;
  });
  return rule !== undefined && !rule.exclude;
}

describe("Android browser-only About page", () => {
  for (const host of ["asocialmedia.cc", "www.asocialmedia.cc"]) {
    for (const path of [
      "/about",
      "/about/",
      "/about/team",
      "/about?source=share",
      "/about#faq",
    ]) {
      test(`${host}${path} stays outside app links`, () => {
        const url = `https://${host}${path}`;
        expect(manifestHandles(url)).toBe(false);
        expect(dynamicRulesAllow(url)).toBe(false);
      });
    }
    for (const path of [
      "/",
      "/posts/post-1",
      "/users/alice",
      "/messages",
      "/settings",
      "/a/community",
    ]) {
      test(`${host}${path} retains app linking`, () => {
        const url = `https://${host}${path}`;
        expect(manifestHandles(url)).toBe(true);
        expect(dynamicRulesAllow(url)).toBe(true);
      });
    }
  }
});
