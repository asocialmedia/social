import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import path from "node:path";

import { legacyProfileDestination, profilePath } from "./profile-path";

function check(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.startsWith("(")) {
      check(path.join(directory, entry.name));
    } else if (!/^[[_@]/.test(entry.name)) {
      expect(profilePath(entry.name)).toBe(
        `/users/${encodeURIComponent(entry.name)}`
      );
    }
  }
}

test("native profile links use the username at the root and encode path segments", () => {
  expect(profilePath("parazeeknova")).toBe("/parazeeknova");
  expect(profilePath("Alice_123")).toBe("/Alice_123");
  expect(profilePath("a/b")).toBe("/a%2Fb");
});

test("all static app routes retain a working legacy profile address for colliding handles", () => {
  check(path.join(import.meta.dir, "../../app"));
  expect(profilePath("Settings")).toBe("/users/Settings");
});

test("legacy profile redirects cover people tabs and social previews without rewriting APIs or app collisions", () => {
  expect(legacyProfileDestination("/users/alice")).toBe("/alice");
  expect(legacyProfileDestination("/users/alice/followers")).toBe(
    "/alice/followers"
  );
  expect(legacyProfileDestination("/users/alice/following")).toBe(
    "/alice/following"
  );
  expect(legacyProfileDestination("/users/alice/opengraph-image")).toBe(
    "/alice/opengraph-image"
  );
  for (const pathname of [
    "/api/users/alice",
    "/users/settings",
    "/users/settings/followers",
    "/users/alice/unknown",
    "/users/%zz",
  ]) {
    expect(legacyProfileDestination(pathname)).toBeNull();
  }
});
