import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { $ } from "bun";

import {
  DEV_REVERSE_PORTS,
  buildAdbReverseArgs,
  buildBootCompletedArgs,
  findNewEmulatorSerial,
  hasAllReverses,
  isBootCompleted,
} from "../apps/mobile/scripts/dev-android-lib";

function getAndroidHome(): string {
  return process.env.ANDROID_HOME ?? join(homedir(), "Android", "Sdk");
}

function findEmulatorBinary(): string | null {
  const whichResult = Bun.which("emulator");
  if (whichResult) {
    return whichResult;
  }

  const androidHome = getAndroidHome();
  const emulatorPath = join(androidHome, "emulator", "emulator");
  if (existsSync(emulatorPath)) {
    return emulatorPath;
  }

  return null;
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: bun run mob:emu [avd_name] [emulator_flags...]");
  console.log("");
  console.log(
    "Starts the default Android emulator available on the device, or the specified AVD."
  );
  console.log(
    "Waits for it to finish booting, then applies the dev port reverses"
  );
  console.log("(3000/3001/8082) so the app reaches this machine's localhost.");
  process.exit(0);
}

const emulatorBin = findEmulatorBinary();
if (!emulatorBin) {
  console.error(
    "Error: Android emulator binary not found. Make sure Android SDK is installed and ANDROID_HOME is set."
  );
  process.exit(1);
}

// Get list of available AVDs
const proc = Bun.spawnSync([emulatorBin, "-list-avds"]);
const avds = proc.stdout
  .toString()
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

if (avds.length === 0) {
  console.error(
    "Error: No Android Virtual Devices (AVDs) found. Create one in Android Studio Device Manager."
  );
  process.exit(1);
}

let targetAvd = avds[0];
let extraArgs = args;

if (args[0] && !args[0].startsWith("-")) {
  targetAvd = args[0];
  extraArgs = args.slice(1);
}

const androidHome = getAndroidHome();
const emulatorLibDirs = [
  join(androidHome, "emulator", "lib64"),
  join(androidHome, "emulator", "lib64", "qt", "lib"),
].filter(existsSync);

const existingLdPath = process.env.LD_LIBRARY_PATH ?? "";
const newLdPath = [...emulatorLibDirs, existingLdPath]
  .filter(Boolean)
  .join(":");

// Discover host Vulkan ICDs for NixOS hardware acceleration
const hostVulkanIcds = [
  "/run/opengl-driver/share/vulkan/icd.d/intel_icd.x86_64.json",
  "/run/opengl-driver/share/vulkan/icd.d/nvidia_icd.json",
].filter(existsSync);
const defaultVkIcd = hostVulkanIcds.join(":");

const hasGpuArg = extraArgs.includes("-gpu");
const spawnArgs = [
  `@${targetAvd}`,
  ...(hasGpuArg ? [] : ["-gpu", "host"]),
  ...extraArgs,
];

console.log(
  `Starting Android emulator: @${targetAvd} with GPU acceleration (host)`
);

// Baseline before spawn: findNewEmulatorSerial compares before/after, so the
// snapshot must predate the launch. Capturing after spawn risks including the
// fresh device in "before" and missing it entirely.
const baselineSnapshot = await devicesSnapshot().catch(() => "");

const child = spawn(emulatorBin, spawnArgs, {
  stdio: "inherit",
  env: {
    ...process.env,
    LD_LIBRARY_PATH: newLdPath,
    QT_QPA_PLATFORM: process.env.QT_QPA_PLATFORM ?? "xcb",
    ...(defaultVkIcd
      ? {
          VK_DRIVER_FILES: process.env.VK_DRIVER_FILES ?? defaultVkIcd,
          VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES ?? defaultVkIcd,
        }
      : {}),
  },
});

child.on("error", (err) => {
  console.error("Failed to start emulator:", err);
  process.exit(1);
});

// If the emulator process dies while we poll, stop waiting immediately
// instead of polling for minutes and timing out.
let childExitCode: number | null = null;
child.on("exit", (code) => {
  childExitCode = code ?? 0;
});

function throwIfChildExited(stage: string): void {
  if (childExitCode !== null) {
    throw new Error(
      `Emulator process exited with code ${childExitCode} while ${stage}.`
    );
  }
}

// A cold boot wipes the adb reverses the app needs for localhost:3000, so
// this command waits for the fresh emulator and re-applies them before it
// returns. Without this, the first launch after every boot fails with
// connection errors until someone re-runs the reverse step by hand.
async function devicesSnapshot(): Promise<string> {
  await $`adb start-server`.quiet().nothrow();
  return await $`adb devices`.text();
}

async function waitForNewEmulator(before: string): Promise<string> {
  const deadline = Date.now() + 240_000;
  for (;;) {
    throwIfChildExited("waiting for the fresh emulator to come online");
    // eslint-disable-next-line no-await-in-loop -- presence polling is inherently sequential; each probe must follow the last
    const snapshot = await devicesSnapshot().catch(() => "");
    const serial = findNewEmulatorSerial(before, snapshot);
    if (serial) {
      return serial;
    }
    throwIfChildExited("waiting for the fresh emulator to come online");
    if (Date.now() > deadline) {
      throw new Error(
        "No fresh emulator came online. If it is still booting, apply the reverses by hand: bun run dev:android --reverse-only (from apps/mobile)."
      );
    }
    await Bun.sleep(3000);
  }
}

async function waitForBoot(serial: string): Promise<void> {
  const deadline = Date.now() + 300_000;
  for (;;) {
    throwIfChildExited("waiting for the emulator to finish booting");
    // eslint-disable-next-line no-await-in-loop -- boot polling is inherently sequential; each probe must follow the last
    const output = await $`adb ${buildBootCompletedArgs(serial)}`
      .quiet()
      .nothrow()
      .text()
      .catch(() => "");
    if (isBootCompleted(output)) {
      return;
    }
    throwIfChildExited("waiting for the emulator to finish booting");
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for ${serial} to finish booting. Apply the reverses by hand once it is up: bun run dev:android --reverse-only (from apps/mobile).`
      );
    }
    await Bun.sleep(3000);
  }
}

async function settleEmulator(before: string): Promise<void> {
  try {
    console.log("Waiting for the fresh emulator to come online...");
    const serial = await waitForNewEmulator(before);
    console.log(`Using ${serial}, waiting for it to finish booting...`);
    await waitForBoot(serial);
    await Promise.all(
      DEV_REVERSE_PORTS.map((port) =>
        $`adb ${buildAdbReverseArgs(serial, port)}`.quiet()
      )
    );
    const reverses = await $`adb -s ${serial} reverse --list`.text();
    console.log(reverses.trim());
    if (!hasAllReverses(reverses, DEV_REVERSE_PORTS)) {
      throw new Error(
        `Ports ${DEV_REVERSE_PORTS.join(", ")} did not stick on ${serial}.`
      );
    }
    console.log("Emulator ready with dev reverses in place.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  process.exit(0);
}

void settleEmulator(baselineSnapshot);
