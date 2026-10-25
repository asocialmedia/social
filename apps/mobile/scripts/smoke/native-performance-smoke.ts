import { mkdir } from "node:fs/promises";

// Validates real scrolling and pager reversals in the installed release app.
// Usage: bun apps/mobile/scripts/smoke/native-performance-smoke.ts
// Keeps the signed-in account and all cached content intact.
// oxlint-disable no-await-in-loop -- Device gestures and their assertions must run in order.
import {
  adb,
  captureScreenshot,
  dumpHierarchy,
  parseUiNodes as parseNodes,
} from "./android";

const packageName = "cc.asocialmedia.mobile";
const artifacts =
  process.env.ASM_PERFORMANCE_ARTIFACTS ?? "/tmp/asm-native-performance-smoke";
await mkdir(artifacts, { recursive: true });

type UiNode = ReturnType<typeof parseNodes>[number];
const size = await adb("shell", "wm", "size");
const dimensions = size.match(/(?<width>\d+)x(?<height>\d+)/)?.groups;
if (!dimensions) {
  throw new Error("Emulator dimensions unavailable");
}
const width = Number(dimensions.width);
const height = Number(dimensions.height);

async function snapshot(): Promise<UiNode[]> {
  await dumpHierarchy("/sdcard/asm-performance.xml", { fast: true });
  const xml = await adb("shell", "cat", "/sdcard/asm-performance.xml");
  await Bun.write(`${artifacts}/latest.xml`, xml);
  if (/Something went wrong|keeps stopping/.test(xml)) {
    throw new Error("App entered an error screen");
  }
  return parseNodes(xml);
}

async function waitFor(
  predicate: (nodes: UiNode[]) => boolean,
  reason: string
) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const nodes = await snapshot();
    if (predicate(nodes)) {
      return nodes;
    }
    await Bun.sleep(200);
  }
  throw new Error(reason);
}

async function capture(name: string) {
  await captureScreenshot(`${artifacts}/${name}.png`);
  await Bun.write(
    `${artifacts}/${name}.xml`,
    await adb("shell", "cat", "/sdcard/asm-performance.xml")
  );
}

async function route(path: string) {
  await adb(
    "shell",
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    `asocialmedia://${path}`,
    "-n",
    `${packageName}/.MainActivity`
  );
}

function selected(nodes: UiNode[], label: string): boolean {
  return nodes.some(
    (node) =>
      node.label === label &&
      node.selected &&
      (node.bounds[1] ?? height) < height / 3
  );
}

async function swipeTab(direction: "left" | "right", label: string) {
  const start = direction === "left" ? 0.85 : 0.15;
  await adb(
    "shell",
    "input",
    "swipe",
    String(width * start),
    String(height * 0.45),
    String(width * (1 - start)),
    String(height * 0.45),
    "250"
  );
  await waitFor(
    (nodes) => selected(nodes, label),
    `Swipe did not select ${label}`
  );
}

function storyNodes(nodes: UiNode[]): UiNode[] {
  return nodes.filter(
    (node) =>
      node.label.startsWith("Open ") &&
      !node.label.includes("HackerNews") &&
      (node.bounds[1] ?? 0) > height / 5
  );
}

const report: Record<string, unknown> = {};
await route("hackernews?sort=score");
const before = await waitFor(
  (nodes) => selected(nodes, "Score") && storyNodes(nodes).length > 1,
  "HN stories unavailable"
);
await capture("hn-before");
const initialPidOutput = await adb("shell", "pidof", packageName);
const initialPid = initialPidOutput.trim();
await adb("shell", "dumpsys", "gfxinfo", packageName, "reset");
for (let index = 0; index < 3; index += 1) {
  await adb(
    "shell",
    "input",
    "swipe",
    String(width * 0.7),
    String(height * 0.78),
    String(width * 0.7),
    String(height * 0.3),
    "350"
  );
  await Bun.sleep(200);
}
const after = await snapshot();
const moved = storyNodes(before).some((node) => {
  const next = storyNodes(after).find(
    (candidate) => candidate.label === node.label
  );
  return !next || Math.abs((next.bounds[1] ?? 0) - (node.bounds[1] ?? 0)) > 100;
});
if (!moved) {
  throw new Error("HN accepted swipes but stories did not scroll");
}
await capture("hn-scrolled");
await Bun.write(
  `${artifacts}/hn-scroll-gfx.txt`,
  await adb("shell", "dumpsys", "gfxinfo", packageName)
);
await swipeTab("left", "Time");
await swipeTab("left", "Comments");
await swipeTab("right", "Time");
await swipeTab("right", "Score");
const searchScreen = await snapshot();
const searchField = searchScreen.find(
  (node) => node.label === "Search HackerNews stories"
);
if (!searchField || searchField.bounds.length !== 4) {
  throw new Error("HN search field unavailable");
}
await adb(
  "shell",
  "input",
  "tap",
  String(((searchField.bounds[0] ?? 0) + (searchField.bounds[2] ?? 0)) / 2),
  String(((searchField.bounds[1] ?? 0) + (searchField.bounds[3] ?? 0)) / 2)
);
await adb("shell", "input", "text", "react");
await Bun.sleep(1200);
await adb(
  "shell",
  "input",
  "keyevent",
  "KEYCODE_DEL",
  "KEYCODE_DEL",
  "KEYCODE_DEL",
  "KEYCODE_DEL",
  "KEYCODE_DEL"
);
await adb("shell", "input", "keyevent", "KEYCODE_BACK");
await waitFor(
  (nodes) => selected(nodes, "Score") && storyNodes(nodes).length > 1,
  "HN did not recover after search"
);
report.hn = { scrolls: 3, sortSwipes: 4, storiesMoved: moved };

await route("discover?tab=trending");
await waitFor(
  (nodes) =>
    selected(nodes, "Trending") &&
    nodes.some(
      (node) =>
        node.label.startsWith("Open post by") ||
        node.label.startsWith("Open Gust by")
    ),
  "Explore content unavailable"
);
await capture("explore-before");
await adb("shell", "dumpsys", "gfxinfo", packageName, "reset");
for (let index = 0; index < 3; index += 1) {
  await swipeTab("left", "Gusts");
  await swipeTab("left", "People");
  await swipeTab("right", "Gusts");
  await swipeTab("right", "Trending");
}
await Bun.write(
  `${artifacts}/explore-swipes-gfx.txt`,
  await adb("shell", "dumpsys", "gfxinfo", packageName)
);
await capture("explore-reversed");
const exploreBeforeScroll = await snapshot();
for (let index = 0; index < 8; index += 1) {
  await adb(
    "shell",
    "input",
    "swipe",
    String(width * 0.7),
    String(height * 0.78),
    String(width * 0.7),
    String(height * 0.3),
    "300"
  );
  await Bun.sleep(150);
}
const exploreAfterScroll = await snapshot();
const exploreCards = (nodes: UiNode[]) =>
  nodes.filter(
    (node) =>
      node.label.startsWith("Open post by") ||
      node.label.startsWith("Open Gust by")
  );
const exploreMoved = exploreCards(exploreBeforeScroll).some(
  (node) =>
    !exploreCards(exploreAfterScroll).some(
      (next) =>
        next.label === node.label &&
        Math.abs((next.bounds[1] ?? 0) - (node.bounds[1] ?? 0)) < 100
    )
);
if (!exploreMoved) {
  throw new Error("Explore accepted swipes but cards did not scroll");
}
await capture("explore-scrolled");
const finalPidOutput = await adb("shell", "pidof", packageName);
const finalPid = finalPidOutput.trim();
if (initialPid !== finalPid) {
  throw new Error("App restarted during the performance smoke");
}
report.explore = {
  cardsMoved: exploreMoved,
  pagerSwipes: 12,
  sameProcess: true,
  scrolls: 8,
};
const nativeLogs = await adb(
  "logcat",
  "-d",
  `--pid=${initialPid}`,
  "-s",
  "Reanimated",
  "AndroidRuntime",
  "ReactNativeJS"
);
await Bun.write(`${artifacts}/native.log`, nativeLogs);
if (
  /synchronouslyUpdateUIProps failed|RetryableMountingLayerException|FATAL EXCEPTION|OutOfMemoryError/.test(
    nativeLogs
  )
) {
  throw new Error(
    "Native animation, mounting or crash errors occurred during the smoke"
  );
}
await Bun.write(
  `${artifacts}/memory.txt`,
  await adb("shell", "dumpsys", "meminfo", packageName)
);
await Bun.write(`${artifacts}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
