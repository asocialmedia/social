import { describe, expect, test } from "bun:test";

import { hashPasswordWithScrypt, verifyPasswordWithScrypt } from "./password";

describe("password hashing", () => {
  test("hashes and verifies correct password", async () => {
    const password = "mySuperSecretPassword123!";
    const hash = await hashPasswordWithScrypt(password);

    expect(hash).toStartWith("scrypt$");
    expect(await verifyPasswordWithScrypt(password, hash)).toBe(true);
  });

  test("rejects incorrect password", async () => {
    const password = "mySuperSecretPassword123!";
    const hash = await hashPasswordWithScrypt(password);

    expect(await verifyPasswordWithScrypt("wrongpassword", hash)).toBe(false);
  });

  test("rejects invalid hash format", async () => {
    expect(
      await verifyPasswordWithScrypt("password", "invalidhashformat")
    ).toBe(false);
    expect(
      await verifyPasswordWithScrypt("password", "scrypt$16384$8$1$salt")
    ).toBe(false); // missing key
  });

  test("rejects invalid numbers in hash", async () => {
    expect(
      await verifyPasswordWithScrypt("password", "scrypt$NaN$8$1$salt$key")
    ).toBe(false);
  });
});
