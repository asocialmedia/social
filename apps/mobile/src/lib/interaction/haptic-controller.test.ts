import { expect, test } from "bun:test";

import {
  createHapticController,
  performHapticPattern,
} from "./haptic-controller";

test("returning to original zoom emits two soft ticks 65ms apart", async () => {
  let clock = 0;
  const pulses: { at: number; feedback: string }[] = [];
  await performHapticPattern(
    "zoom-reset",
    (feedback) => {
      pulses.push({ at: clock, feedback });
      return Promise.resolve();
    },
    (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    () => clock
  );
  expect(pulses).toEqual([
    { at: 0, feedback: "selection" },
    { at: 65, feedback: "selection" },
  ]);
});

test("the second zoom tick is discarded when the runtime resumes late", async () => {
  let clock = 0;
  const pulses: string[] = [];
  await performHapticPattern(
    "zoom-reset",
    (feedback) => {
      pulses.push(feedback);
      return Promise.resolve();
    },
    () => {
      clock += 500;
      return Promise.resolve();
    },
    () => clock
  );
  expect(pulses).toEqual(["selection"]);
});

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
