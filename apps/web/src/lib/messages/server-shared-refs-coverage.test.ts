import { describe, expect, test } from "bun:test";

import { shouldPollServerSharedRefsCoverage } from "./server-shared-refs-coverage";

const POLLABLE = {
  coverageIncomplete: true,
  coverageUnavailable: false,
  requestLoading: false,
  serverMode: true,
  source: "server" as const,
};

describe("server shared-reference coverage refresh policy", () => {
  test("polls only an incomplete server-backed index", () => {
    expect(shouldPollServerSharedRefsCoverage(POLLABLE)).toBe(true);
    expect(
      shouldPollServerSharedRefsCoverage({ ...POLLABLE, source: "local" })
    ).toBe(false);
    expect(
      shouldPollServerSharedRefsCoverage({ ...POLLABLE, serverMode: false })
    ).toBe(false);
  });

  test("stops polling after settlement, unavailability, or during a request", () => {
    expect(
      shouldPollServerSharedRefsCoverage({
        ...POLLABLE,
        coverageIncomplete: false,
      })
    ).toBe(false);
    expect(
      shouldPollServerSharedRefsCoverage({
        ...POLLABLE,
        coverageUnavailable: true,
      })
    ).toBe(false);
    expect(
      shouldPollServerSharedRefsCoverage({ ...POLLABLE, requestLoading: true })
    ).toBe(false);
    expect(
      shouldPollServerSharedRefsCoverage({ ...POLLABLE, source: null })
    ).toBe(false);
  });
});
