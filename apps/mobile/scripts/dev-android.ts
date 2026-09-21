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
  buildExpoArgs,
  hasOfflineEmulator,
  parseDevAndroidArgs,
  pickDeviceSerial,
  resolveExpoDeviceName,
} from "./dev-android-lib";

function step(message: string): void {
  console.log(`\n\u001B[1m==> ${message}\u001B[0m`);
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

  step(`Reversing ports ${DEV_REVERSE_PORTS.join(", ")} to this machine`);
  await Promise.all(
    DEV_REVERSE_PORTS.map((port) =>
      $`adb ${buildAdbReverseArgs(serial, port)}`.quiet()
    )
  );
  const reverses = await $`adb -s ${serial} reverse --list`.text();
  console.log(reverses.trim());

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
