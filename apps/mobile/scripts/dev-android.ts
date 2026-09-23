// Starts the app on the Android emulator (or a USB device) as an Expo dev
// build, with the port reverses the auth flows depend on.
//
// Why reverses: the app, the auth service's OAuth redirect and the Turnstile
// page all use `localhost` in dev (see src/lib/api-base.ts). On the emulator
// `localhost` is the emulator itself unless adb forwards those ports back to
// this machine. Expo reverses the Metro port on its own; 3000/3001 are ours.
//
//   bun run dev:android                 dev client (expo run:android)
//   bun run dev:android --go            Expo Go fallback (no native modules)
//   bun run dev:android --reverse-only  re-apply reverses after an emulator reboot
//   bun run dev:android --device <serial>
import { $ } from "bun";

import {
  DEV_REVERSE_PORTS,
  METRO_PORT,
  buildAdbReverseArgs,
  buildBootCompletedArgs,
  buildExpoArgs,
  hasAllReverses,
  hasOfflineEmulator,
  isBootCompleted,
  parseDevAndroidArgs,
  pickDeviceSerial,
  resolveExpoDeviceName,
} from "./dev-android-lib";

function step(message: string): void {
  console.log(`\n\u001B[1m==> ${message}\u001B[0m`);
}

// Reverses applied mid-boot silently vanish, so wait for full boot first.
// adb reports the device "online" long before sys.boot_completed flips.
async function waitForBoot(serial: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- boot polling is inherently sequential; each probe must follow the last
    const output = await $`adb ${buildBootCompletedArgs(serial)}`
      .quiet()
      .nothrow()
      .text();
    if (isBootCompleted(output)) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for ${serial} to finish booting. Retry once the emulator is up.`
      );
    }
    // eslint-disable-next-line no-await-in-loop -- boot backoff between probes; each probe must follow the last
    await Bun.sleep(2000);
  }
}

async function applyReverses(serial: string): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- reverse apply-verify rounds must run sequentially
      await Promise.all(
        DEV_REVERSE_PORTS.map((port) =>
          $`adb ${buildAdbReverseArgs(serial, port)}`.quiet()
        )
      );
      // eslint-disable-next-line no-await-in-loop -- reverse verification must run after each apply round, sequentially
      const reverses = await $`adb -s ${serial} reverse --list`.text();
      console.log(reverses.trim());
      if (hasAllReverses(reverses, DEV_REVERSE_PORTS)) {
        return;
      }
      console.log(
        `Reverse check failed (attempt ${attempt}/3), re-applying...`
      );
    } catch (attemptError) {
      lastError = attemptError;
      console.log(
        `Reverse attempt ${attempt}/3 failed (${attemptError instanceof Error ? attemptError.message : String(attemptError)}), re-applying...`
      );
    }
    // eslint-disable-next-line no-await-in-loop -- retry backoff between reverse attempts; each round must follow the last
    await Bun.sleep(2000);
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(
    `Ports ${DEV_REVERSE_PORTS.join(", ")} did not stick on ${serial}${detail}. ` +
      `The app will fail to reach localhost:3000 until they do - fix adb and retry.`
  );
}

async function main(): Promise<void> {
  const options = parseDevAndroidArgs(process.argv.slice(2));

  step("Looking for an online Android device");
  await $`adb start-server`.quiet();
  let devices = await $`adb devices`.text();
  if (hasOfflineEmulator(devices)) {
    // Expo aborts on stale emulator rows; only an adb restart clears them.
    console.log("Clearing a stale offline emulator entry (adb restart)");
    await $`adb kill-server`.quiet();
    await $`adb start-server`.quiet();
    devices = await $`adb devices`.text();
  }
  const serial = pickDeviceSerial(
    devices,
    options.device ?? process.env.ASM_ANDROID_SERIAL
  );
  if (!serial) {
    console.error(devices.trim());
    console.error(
      "\nNo online device. Start one with `bun run mob:emu` (repo root) or plug in a phone with USB debugging, then retry."
    );
    process.exit(1);
  }
  console.log(`Using ${serial}`);

  step("Waiting for the device to finish booting (reverses vanish mid-boot)");
  await waitForBoot(serial);

  step(`Reversing ports ${DEV_REVERSE_PORTS.join(", ")} to this machine`);
  await applyReverses(serial);

  if (options.reverseOnly) {
    return;
  }

  // Expo matches --device against its own display name, not the serial.
  const devicesLong = await $`adb devices -l`.text();
  const avdName = serial.startsWith("emulator-")
    ? await $`adb -s ${serial} emu avd name`.text()
    : null;
  const deviceName = resolveExpoDeviceName(serial, devicesLong, avdName);
  const expoArgs = buildExpoArgs({
    deviceName,
    go: options.go,
    port: METRO_PORT,
  });
  step(`bunx ${expoArgs.join(" ")}`);
  // Inherit stdio so Metro's interactive keys keep working.
  const child = Bun.spawn(["bunx", ...expoArgs], {
    cwd: import.meta.dir.replace(/\/scripts$/, ""),
    env: process.env,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  const code = await child.exited;
  process.exit(code ?? 0);
}

await main();
