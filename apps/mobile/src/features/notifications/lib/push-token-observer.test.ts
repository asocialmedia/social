import { expect, test } from "bun:test";

import { createPushTokenObserver } from "./push-token-observer";

test("FCM get-token echoes cannot recursively register the same device", () => {
  let registrations = 0;
  let registered: string | null = null;
  const onToken = createPushTokenObserver(
    () => registered,
    () => {
      registrations += 1;
      onToken("first");
    }
  );
  onToken("first");
  onToken("first");
  registered = "first";
  onToken("first");
  expect(registrations).toBe(1);
  onToken("rotated");
  onToken("rotated");
  expect(registrations).toBe(2);
});
