import { expect, test } from "bun:test";

import { appendNetworkQuery } from "./network-query";

test("retains opaque cursor and request parameters while supplying the active persona", () => {
  const cursor = "opaque:+/=&";
  const path = appendNetworkQuery(
    `/api/posts/for-you?${new URLSearchParams({ cursor, take: "20" })}`,
    {
      locale: "en-IN",
      profile: "work",
      scope: "revision-8",
      surface: "explore",
    }
  );
  const query = new URL(path, "https://asm.test").searchParams;
  expect(Object.fromEntries(query)).toEqual({
    cursor,
    locale: "en-IN",
    network: "revision-8",
    profile: "work",
    surface: "explore",
    take: "20",
  });
});
