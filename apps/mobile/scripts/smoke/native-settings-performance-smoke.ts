import { mkdir } from "node:fs/promises";

// Measures release Settings tab taps and swipe reversals without changing settings.
// Usage: ASM_SETTINGS_PERF_LABEL=baseline bun apps/mobile/scripts/smoke/native-settings-performance-smoke.ts
// oxlint-disable no-await-in-loop -- Device gestures and assertions must run in order.
import { adb, captureScreenshot, parseUiNodes } from "./android";

const packageName = "cc.asocialmedia.mobile";
const artifactDirectory =
  process.env.ASM_SETTINGS_PERF_ARTIFACTS ?? "/tmp/asm-settings-performance";
const label = process.env.ASM_SETTINGS_PERF_LABEL ?? "candidate";
await mkdir(artifactDirectory, { recursive: true });

const display = await adb("shell", "wm", "size");
const dimensions = [...display.matchAll(/(?<width>\d+)x(?<height>\d+)/g)].at(
  -1
)?.groups;
if (!dimensions) {
  throw new Error("Display size unavailable");
}
const width = Number(dimensions.width);
const height = Number(dimensions.height);

async function snapshot() {
  await adb(
    "shell",
    "env",
    "CLASSPATH=/data/local/tmp/asm-fast-dump.jar:/system/framework/uiautomator.jar",
    "app_process",
    "/system/bin",
    "AsmFastDump",
    "/sdcard/asm-settings-perf.xml"
  );
  const xml = await adb("shell", "cat", "/sdcard/asm-settings-perf.xml");
  await Bun.write(`${artifactDirectory}/${label}-latest.xml`, xml);
  if (
    !xml.includes("Search settings") ||
    /Something went wrong|keeps stopping/.test(xml)
  ) {
    throw new Error("Settings lost foreground or entered an error screen");
  }
  return parseUiNodes(xml);
}

async function assertSelected(tab: string) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const nodes = await snapshot();
    const selected = nodes.some((node) => node.label === tab && node.selected);
    const content = nodes.some(
      (node) => node.text === tab && (node.bounds[1] ?? 0) > height / 5
    );
    if (selected && content) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Gesture did not present ${tab} and its form`);
}

async function capture(name: string) {
  await captureScreenshot(`${artifactDirectory}/${label}-${name}.png`);
}

async function frames(phase: string) {
  const output = await adb("shell", "dumpsys", "gfxinfo", packageName);
  await Bun.write(`${artifactDirectory}/${label}-${phase}-gfx.txt`, output);
  const summary = output
    .split("\n")
    .filter((line) =>
      /Total frames rendered|Janky frames:|percentile:|Number Slow UI|Number Slow issue|Total attached Views/.test(
        line
      )
    );
  console.log(phase, summary.join("\n"));
  return summary;
}

await adb("shell", "am", "force-stop", packageName);
const launch = await adb(
  "shell",
  "am",
  "start",
  "-W",
  "-n",
  `${packageName}/.MainActivity`,
  "-a",
  "android.intent.action.VIEW",
  "-d",
  "asocialmedia://settings?tab=profile"
);
await Bun.write(`${artifactDirectory}/${label}-launch.txt`, launch);
if (!launch.includes("Status: ok")) {
  throw new Error("Release cold launch failed");
}
await Bun.sleep(2500);
await assertSelected("Profile");
const initialPidOutput = await adb("shell", "pidof", packageName);
const initialPid = initialPidOutput.trim();
await capture("before");
const tabs = [
  "Account",
  "Privacy",
  "Security",
  "Personalization",
  "Security",
  "Privacy",
  "Account",
  "Profile",
];
const measurements: Record<string, string[]> = {};
for (const phase of ["taps-first", "taps-repeat"]) {
  await adb("shell", "dumpsys", "gfxinfo", packageName, "reset");
  for (const tab of tabs) {
    const nodes = await snapshot();
    const target = nodes.find(
      (node) => node.label === tab && (node.bounds[1] ?? height) < height / 4
    );
    if (!target || target.bounds.length !== 4) {
      throw new Error(`Tab ${tab} is outside the visible strip`);
    }
    const [left = 0, top = 0, right = 0, bottom = 0] = target.bounds;
    await adb(
      "shell",
      "input",
      "tap",
      String((left + right) / 2),
      String((top + bottom) / 2)
    );
    await Bun.sleep(500);
    await assertSelected(tab);
  }
  measurements[phase] = await frames(phase);
}
await adb("shell", "dumpsys", "gfxinfo", packageName, "reset");
for (let cycle = 0; cycle < 2; cycle += 1) {
  for (const [index, tab] of tabs.entries()) {
    const start = index < 4 ? 0.85 : 0.15;
    await adb(
      "shell",
      "input",
      "swipe",
      String(width * start),
      String(height * 0.56),
      String(width * (1 - start)),
      String(height * 0.56),
      "250"
    );
    await Bun.sleep(500);
    await assertSelected(tab);
  }
}
measurements.swipes = await frames("swipes");
await capture("after");
const finalPidOutput = await adb("shell", "pidof", packageName);
if (finalPidOutput.trim() !== initialPid) {
  throw new Error("App restarted during tab switching");
}
const logs = await adb(
  "logcat",
  "-d",
  `--pid=${initialPid}`,
  "-s",
  "Reanimated",
  "AndroidRuntime",
  "ReactNativeJS"
);
await Bun.write(`${artifactDirectory}/${label}-native.log`, logs);
if (
  /FATAL EXCEPTION|OutOfMemoryError|synchronouslyUpdateUIProps failed|RetryableMountingLayerException/.test(
    logs
  )
) {
  throw new Error("Native animation or crash errors during tab switching");
}
await Bun.write(
  `${artifactDirectory}/${label}-memory.txt`,
  await adb("shell", "dumpsys", "meminfo", packageName)
);
await Bun.write(
  `${artifactDirectory}/${label}-report.json`,
  JSON.stringify(
    { measurements, sameProcess: true, swipeSwitches: 16, tapSwitches: 16 },
    null,
    2
  )
);
console.log(
  "PASS all five Settings tabs: 16 taps, 16 swipes, same process, no native animation errors"
);
