import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
