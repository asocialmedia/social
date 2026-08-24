import { describe, expect, test } from "bun:test";

import { parseResponse } from "./clamav";

describe("clamd response parsing", () => {
  test("clean verdicts", () => {
    expect(parseResponse("stream: OK\0")).toEqual({ clean: true });
    expect(parseResponse("OK\0")).toEqual({ clean: true });
  });

  test("signature detections extract the name", () => {
    const verdict = parseResponse("stream: Eicar-Test-Signature FOUND\0");
    expect(verdict.clean).toBe(false);
    expect(verdict.signature).toBe("Eicar-Test-Signature");
  });

  test("unrecognized responses throw instead of passing silently", () => {
    expect(() => parseResponse("UNKNOWN PROTOCOL STATE\0")).toThrow();
    expect(() => parseResponse("\0")).toThrow();
  });
});
