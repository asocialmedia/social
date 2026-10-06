import { describe, expect, test } from "bun:test";

import { ViewBatcher } from "./view-batcher";

const OPTIONS = { apiBase: "https://api.test" };

function recorder() {
  const batches: string[][] = [];
  const submit = (postIds: string[]) => {
    batches.push([...postIds]);
    return Promise.resolve(Object.fromEntries(postIds.map((id) => [id, 1])));
  };
  return { batches, submit };
}

describe("ViewBatcher", () => {
  test("counts a post once per session, not once per scroll pass", async () => {
    const { batches, submit } = recorder();
    const batcher = new ViewBatcher(submit);

    batcher.mark("post-1", OPTIONS);
    await batcher.flush();

    // Scrolling back up re-marks the same post. The server already recorded it
    // for this viewer, so this must not produce another request.
    batcher.mark("post-1", OPTIONS);
    await batcher.flush();

    expect(batches).toEqual([["post-1"]]);
  });

  test("still counts a post the viewer has not seen yet", async () => {
    const { batches, submit } = recorder();
    const batcher = new ViewBatcher(submit);

    batcher.mark("post-1", OPTIONS);
    batcher.mark("post-2", OPTIONS);
    await batcher.flush();

    expect(batches).toEqual([["post-1", "post-2"]]);
  });

  test("a failed batch stays eligible for the retry", async () => {
    let attempts = 0;
    const submit = (_postIds: string[]) => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(new Error("offline"));
      }
      return Promise.resolve({});
    };
    const batcher = new ViewBatcher(submit);

    batcher.mark("post-1", OPTIONS);
    await batcher.flush();
    // The id was requeued rather than retired, so re-marking it is not
    // suppressed and the view is not silently lost.
    batcher.mark("post-1", OPTIONS);
    await batcher.flush();

    expect(attempts).toBe(2);
  });

  test("the counted set is bounded", async () => {
    const { submit } = recorder();
    const batcher = new ViewBatcher(submit, { maxCounted: 2 });

    batcher.mark("a", OPTIONS);
    await batcher.flush();
    batcher.mark("b", OPTIONS);
    await batcher.flush();
    batcher.mark("c", OPTIONS);
    await batcher.flush();

    // "a" aged out, so it can be counted again; the newer ids stay retired.
    batcher.mark("b", OPTIONS);
    await batcher.flush();
    expect(batcher.size).toBe(0);
  });
});

test("view batches read renewed cookies at flush time rather than scroll time", async () => {
  let cookie = "old";
  const sent: (string | undefined)[] = [];
  const batcher = new ViewBatcher((_ids, options) => {
    sent.push(options.cookie);
    return Promise.resolve({});
  });
  batcher.mark("p1", {
    apiBase: OPTIONS.apiBase,
    getCookie: () => Promise.resolve(cookie),
  });
  cookie = "renewed";
  await batcher.flush();
  expect(sent).toEqual(["renewed"]);
});

test("a slow batch cannot overlap the next view batch", async () => {
  const response = Promise.withResolvers<Record<string, number>>();
  const batches: string[][] = [];
  const batcher = new ViewBatcher((ids) => {
    batches.push(ids);
    return batches.length === 1 ? response.promise : Promise.resolve({});
  });
  batcher.mark("p1", OPTIONS);
  const first = batcher.flush();
  batcher.mark("p2", OPTIONS);
  await batcher.flush();
  expect(batches).toEqual([["p1"]]);
  response.resolve({ p1: 1 });
  await first;
  await batcher.flush();
  expect(batches).toEqual([["p1"], ["p2"]]);
});
