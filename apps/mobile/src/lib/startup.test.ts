import { expect, test } from "bun:test";

import { prepareStartup, resumeHref, startupDestination } from "./startup";

test("launch waits for every local cache, tolerates failure and never waits on network", async () => {
  const { promise: pending, resolve: release } =
    Promise.withResolvers<undefined>();
  let finished = false;
  const preparation = prepareStartup(
    [
      () => pending,
      () => {
        throw new Error("corrupt disk");
      },
    ],
    500
  );
  void preparation.then(() => {
    finished = true;
  });
  await Bun.sleep(10);
  expect(finished).toBe(false);
  release();
  await preparation;
  expect(finished).toBe(true);
});

test("an unavailable local bridge cannot strand startup", async () => {
  const { promise } = Promise.withResolvers<undefined>();
  await prepareStartup([() => promise], 10);
});

test("deep links win over saved navigation and query parameters survive restoration", () => {
  const resume = {
    params: { comment: "a b?" },
    pathname: "/posts/saved",
    updatedAt: 1,
  };
  expect(startupDestination("/", resume)).toBe("/posts/saved");
  expect(startupDestination("/posts/deep-link", resume)).toBe(
    "/posts/deep-link"
  );
  expect(startupDestination("/", null)).toBe("/");
  expect(resumeHref(resume)).toBe("/posts/saved?comment=a%20b%3F");
});
