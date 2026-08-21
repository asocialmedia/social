import { describe, expect, test } from "bun:test";

import {
  isReservedUsername,
  RESERVED_USERNAME_LIST,
} from "./reserved-usernames";

describe("isReservedUsername", () => {
  test("rejects the reserved zeph handle case-insensitively", () => {
    expect(isReservedUsername("zeph")).toBe(true);
    expect(isReservedUsername("Zeph")).toBe(true);
    expect(isReservedUsername("ZEPH")).toBe(true);
    expect(isReservedUsername(" zeph ")).toBe(true);
  });

  test("accepts other usernames", () => {
    expect(isReservedUsername("zephyr")).toBe(false);
    expect(isReservedUsername("zepph")).toBe(false);
    expect(isReservedUsername("admin")).toBe(false);
    expect(isReservedUsername("user123")).toBe(false);
  });

  test("handles empty and null input", () => {
    expect(isReservedUsername(null)).toBe(false);
    expect(isReservedUsername()).toBe(false);
    expect(isReservedUsername("")).toBe(false);
  });

  test("exports the reserved list", () => {
    expect(RESERVED_USERNAME_LIST).toEqual(["zeph"]);
  });
});
