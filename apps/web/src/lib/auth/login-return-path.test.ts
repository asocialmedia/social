import { expect, test } from "bun:test";

import { getLoginReturnPath } from "./login-return-path";

test("keeps the community channel and message destination after sign-in", () => {
  const path = "/a/table/chat/general/threads/ideas?message=note#reply";
  expect(getLoginReturnPath(`?next=${encodeURIComponent(path)}`)).toBe(path);
});

test("defaults ordinary sign-in to home", () => {
  expect(getLoginReturnPath("")).toBe("/");
  expect(getLoginReturnPath("?next=")).toBe("/");
});

test("rejects external and browser-normalized redirect destinations", () => {
  for (const destination of [
    "https://example.com/",
    "//example.com/",
    "/\\example.com/",
    ["javascript", "alert(1)"].join(":"),
    "example.com/path",
  ]) {
    expect(getLoginReturnPath(`?next=${encodeURIComponent(destination)}`)).toBe(
      "/"
    );
  }
});
