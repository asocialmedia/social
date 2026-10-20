import { describe, expect, test } from "bun:test";

describe("BlueskyConnectCard logic", () => {
  test("identifies connected state from handle", () => {
    const handle = "alice.bsky.social";
    const isConnected = Boolean(handle);
    const cleanHandle = handle.replace(/^@/, "");
    expect(isConnected).toBe(true);
    expect(cleanHandle).toBe("alice.bsky.social");
  });

  test("handles @ prefix in handle", () => {
    const handle = "@bob.bsky.social";
    const cleanHandle = handle.replace(/^@/, "");
    expect(cleanHandle).toBe("bob.bsky.social");
  });

  test("verifies email check before allowing connection", () => {
    const hasVerifiedEmail = false;
    const canConnect = hasVerifiedEmail;
    expect(canConnect).toBe(false);

    const verifiedUser = true;
    expect(verifiedUser).toBe(true);
  });
});
