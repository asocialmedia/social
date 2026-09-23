import { describe, expect, test } from "bun:test";

import { isAllowedPushEndpoint } from "./push-endpoint";

describe("isAllowedPushEndpoint", () => {
  test("accepts the real browser push services over https", () => {
    expect(
      isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")
    ).toBe(true);
    expect(
      isAllowedPushEndpoint(
        "https://updates.push.services.mozilla.com/wpush/v2/x"
      )
    ).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QK1")).toBe(true);
    expect(
      isAllowedPushEndpoint("https://db5.notify.windows.com/w/?token=1")
    ).toBe(true);
  });

  test("rejects internal, plain-http, odd-port and look-alike endpoints", () => {
    expect(
      isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")
    ).toBe(false);
    expect(
      isAllowedPushEndpoint("https://169.254.169.254/latest/meta-data")
    ).toBe(false);
    expect(isAllowedPushEndpoint("https://localhost:3000/api")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(
      false
    );
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.io/x")).toBe(
      false
    );
    expect(
      isAllowedPushEndpoint("https://evilpush.apple.com.attacker.dev/x")
    ).toBe(false);
    expect(isAllowedPushEndpoint("https://user:pw@fcm.googleapis.com/x")).toBe(
      false
    );
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
  });
});
