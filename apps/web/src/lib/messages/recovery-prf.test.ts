import { describe, expect, test } from "bun:test";

import { derivePrfSalt, extractPrfOutput, prfEnabled } from "./recovery-prf";

describe("derivePrfSalt", () => {
  test("is deterministic for the same user", async () => {
    const first = await derivePrfSalt("user-1");
    const second = await derivePrfSalt("user-1");
    expect(first).toEqual(second);
  });

  test("is 32 bytes and distinct per user", async () => {
    const a = await derivePrfSalt("user-1");
    const b = await derivePrfSalt("user-2");
    expect(a.byteLength).toBe(32);
    expect(b.byteLength).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

describe("prfEnabled", () => {
  test("is true only when the authenticator reports PRF support", () => {
    expect(prfEnabled({ prf: { enabled: true } })).toBe(true);
    expect(prfEnabled({ prf: { enabled: false } })).toBe(false);
    expect(prfEnabled({})).toBe(false);
  });
});

describe("extractPrfOutput", () => {
  test("returns the bytes when the authenticator produced them", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const output = extractPrfOutput({
      prf: { enabled: true, results: { first: bytes.buffer } },
    });
    expect(output).not.toBeNull();
    expect([...output as Uint8Array]).toEqual([1, 2, 3, 4]);
  });

  test("normalizes a buffer view, honoring its offset and length", () => {
    // A view into a larger buffer must not yield the whole underlying buffer.
    const backing = new Uint8Array([9, 9, 5, 6, 9, 9]);
    const view = backing.subarray(2, 4);
    const output = extractPrfOutput({
      prf: { results: { first: view } },
    });
    expect([...output as Uint8Array]).toEqual([5, 6]);
  });

  test("is null when PRF is unsupported or produced no result", () => {
    expect(extractPrfOutput({})).toBeNull();
    expect(extractPrfOutput({ prf: { enabled: true } })).toBeNull();
    expect(extractPrfOutput({ prf: { enabled: false } })).toBeNull();
  });
});
