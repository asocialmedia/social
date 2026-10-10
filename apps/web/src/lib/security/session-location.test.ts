import { expect, test } from "bun:test";

import {
  isPublicSessionAddress,
  parseSessionLocation,
} from "./session-location";

test("location lookup never sends private network addresses or arbitrary hosts", () => {
  for (const address of [
    "127.0.0.1",
    "10.4.0.3",
    "192.168.1.1",
    "172.31.1.1",
    "100.64.1.1",
    "169.254.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
    "fe80::1",
    "example.com",
  ]) {
    expect(isPublicSessionAddress(address)).toBe(false);
  }
  expect(isPublicSessionAddress("8.8.8.8")).toBe(true);
  expect(isPublicSessionAddress("2606:4700:4700::1111")).toBe(true);
});

test("only successful coarse city and country fields are accepted", () => {
  expect(
    parseSessionLocation({
      city: "Betul",
      country_code: "IN",
      ip: "private",
      latitude: 1,
      success: true,
    })
  ).toEqual({ city: "Betul", country: "IN" });
  expect(
    parseSessionLocation({
      city: "Unknown",
      country_code: "IN",
      success: false,
    })
  ).toBeNull();
  expect(
    parseSessionLocation({ country_code: "India", success: true })
  ).toBeNull();
});
