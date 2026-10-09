import { expect, test } from "bun:test";

import { createHapticController } from "./haptic-controller";

test("overlapping actions produce one pulse and slow module loading never replays it", async () => {
  let clock = 0;
  let pulses = 0;
  const ready = Promise.withResolvers<undefined>();
  const haptic = createHapticController(
    async () => {
      await ready.promise;
      return () => {
        pulses += 1;
        return Promise.resolve();
      };
    },
    () => clock
  );
  haptic();
  clock = 200;
  haptic("success");
  ready.resolve();
  await Bun.sleep(0);
  expect(pulses).toBe(0);
  haptic("hold");
  await Bun.sleep(0);
  expect(pulses).toBe(1);
  haptic();
  await Bun.sleep(0);
  expect(pulses).toBe(1);
});
