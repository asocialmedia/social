import { describe, expect, test } from "bun:test";

import { openUrlSafely } from "./open-url-core";

describe("openUrlSafely", () => {
  test("opens a trimmed URL and reports success", async () => {
    const opened: string[] = [];
    const failures: string[] = [];
    const result = await openUrlSafely("  https://example.com  ", {
      onFailure: (url) => failures.push(url),
      open: (url) => {
        opened.push(url);
        return Promise.resolve();
      },
    });
    expect(result).toBe(true);
    expect(opened).toEqual(["https://example.com"]);
    expect(failures).toEqual([]);
  });

  test("a rejected open is caught and reported, never thrown", async () => {
    const failures: string[] = [];
    const result = await openUrlSafely("weird://nothing-handles-this", {
      onFailure: (url) => failures.push(url),
      open: () => Promise.reject(new Error("No activity found")),
    });
    expect(result).toBe(false);
    expect(failures).toEqual(["weird://nothing-handles-this"]);
  });

  test("an empty target fails without calling the system", async () => {
    let calls = 0;
    const failures: string[] = [];
    const result = await openUrlSafely("   ", {
      onFailure: (url) => failures.push(url),
      open: () => {
        calls += 1;
        return Promise.resolve();
      },
    });
    expect(result).toBe(false);
    expect(calls).toBe(0);
    expect(failures).toHaveLength(1);
  });
});
