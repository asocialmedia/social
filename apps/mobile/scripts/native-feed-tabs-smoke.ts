// Runs against the installed release APK without clearing its account or tab memory.
// Usage: bun apps/mobile/scripts/native-feed-tabs-smoke.ts
import { mkdir } from "node:fs/promises";

const packageName = "cc.asocialmedia.mobile";
const artifactDirectory = "/tmp/asm-feed-tabs-smoke";
await mkdir(artifactDirectory, { recursive: true });

async function adb(...args: string[]) {
  const command = Bun.spawn(["adb", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
    command.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`adb ${args[0]} failed: ${stderr}`);
  }
  return stdout;
}

function parseNodes(xml: string) {
  return [...xml.matchAll(/<node\s[^>]+>/g)].map(([node]) => ({
    bounds: [
      ...(
        node.match(/bounds="(?<bounds>[^"]+)"/)?.groups?.bounds ?? ""
      ).matchAll(/\d+/g),
    ].map(([value]) => Number(value)),
    label: node.match(/content-desc="(?<label>[^"]*)"/)?.groups?.label ?? "",
    selected: node.includes('selected="true"'),
    text: node.match(/text="(?<text>[^"]*)"/)?.groups?.text ?? "",
  }));
}

type UiNode = ReturnType<typeof parseNodes>[number];

let viewingGusts = false;

async function snapshot() {
  await adb("shell", "rm", "-f", "/sdcard/asm-feed-tabs-smoke.xml");
  let output = await adb(
    "shell",
    "uiautomator",
    "dump",
    "/sdcard/asm-feed-tabs-smoke.xml"
  );
  if (!output.includes("dumped to:") && viewingGusts) {
    // Pause the playing clip so its progress and captions let Android reach idle.
    await adb(
      "shell",
      "input",
      "tap",
      String(screenWidth / 2),
      String(screenHeight * 0.4)
    );
    await Bun.sleep(1000);
    output = await adb(
      "shell",
      "uiautomator",
      "dump",
      "/sdcard/asm-feed-tabs-smoke.xml"
    );
  }
  if (!output.includes("dumped to:")) {
    throw new Error(
      "Android hierarchy did not reach idle; no stale dump was read"
    );
  }
  const xml = await adb("shell", "cat", "/sdcard/asm-feed-tabs-smoke.xml");
  await Bun.write(`${artifactDirectory}/latest.xml`, xml);
  if (/Something went wrong|keeps stopping/.test(xml)) {
    throw new Error("The app entered an error screen");
  }
  return parseNodes(xml);
}

async function tap(node: UiNode | undefined) {
  if (!node || node.bounds.length !== 4) {
    throw new Error("Expected feed control is absent");
  }
  const [left = 0, top = 0, right = 0, bottom = 0] = node.bounds;
  await adb(
    "shell",
    "input",
    "tap",
    String((left + right) / 2),
    String((top + bottom) / 2)
  );
  await Bun.sleep(400);
}

async function capture(name: string) {
  const process = Bun.spawn(["adb", "exec-out", "screencap", "-p"], {
    stdout: "pipe",
  });
  await Bun.write(
    `${artifactDirectory}/${name}.png`,
    await new Response(process.stdout).arrayBuffer()
  );
  if ((await process.exited) !== 0) {
    throw new Error("Screenshot failed");
  }
}

function expectSelected(screen: UiNode[], label: string) {
  if (!screen.some((node) => node.label === label && node.selected)) {
    throw new Error(`Expected selected feed: ${label}`);
  }
  expectMenu(screen, false);
}

function expectMenu(screen: UiNode[], open: boolean, alternative?: string) {
  if (screen.some((node) => node.label === "Close menu") !== open) {
    throw new Error(`Expected feed menu to be ${open ? "open" : "closed"}`);
  }
  if (open) {
    const entries = screen.filter((node) =>
      ["Trending", "For you", "Latest"].includes(node.label)
    );
    if (entries.length !== 1 || entries[0]?.label !== alternative) {
      throw new Error(
        `Expected only ${alternative} in menu, found ${entries.map((node) => node.label)}`
      );
    }
  }
}

const sizeOutput = await adb("shell", "wm", "size");
const size = sizeOutput.match(/(?<width>\d+)x(?<height>\d+)/);
const screenWidth = Number(size?.groups?.width);
const screenHeight = Number(size?.groups?.height);
if (!screenWidth || !screenHeight) {
  throw new Error("Cannot determine emulator screen dimensions");
}

async function swipe(direction: "left" | "right") {
  const left = Math.round(screenWidth * 0.12);
  const right = Math.round(screenWidth * 0.85);
  const y = String(Math.round(screenHeight * 0.38));
  await adb(
    "shell",
    "input",
    "swipe",
    String(direction === "right" ? left : right),
    y,
    String(direction === "right" ? right : left),
    y,
    "350"
  );
  await Bun.sleep(500);
  return snapshot();
}

const packageInfo = await adb("shell", "dumpsys", "package", packageName);
if (packageInfo.includes("DEBUGGABLE")) {
  throw new Error("This smoke test requires a release APK");
}
await adb("shell", "am", "force-stop", packageName);
await adb("shell", "am", "start", "-W", "-n", `${packageName}/.MainActivity`);
await Bun.sleep(2000);
// Android may restore a playing Gust instead of Home after a release reinstall.
viewingGusts = true;
let screen = await snapshot();
if (screen.some((node) => node.label === "Following Gusts")) {
  await adb("shell", "input", "keyevent", "4");
  await Bun.sleep(400);
  screen = await snapshot();
}
viewingGusts = false;
await tap(screen.find((node) => node.label === "Home"));
screen = await snapshot();
await tap(screen.find((node) => node.label === "Latest"));
screen = await snapshot();
expectSelected(screen, "Latest");
const discovery = screen.find((node) =>
  ["For you", "Trending"].includes(node.label)
);
await tap(discovery);
screen = await snapshot();
const initialDiscovery = discovery?.label ?? "";
expectSelected(screen, initialDiscovery);
await tap(screen.find((node) => node.label === initialDiscovery));
screen = await snapshot();
const firstAlternative =
  initialDiscovery === "Trending" ? "For you" : "Trending";
expectMenu(screen, true, firstAlternative);
await tap(screen.find((node) => node.label === firstAlternative));
screen = await snapshot();
expectSelected(screen, firstAlternative);
console.log(
  "PASS home: inactive discovery navigates; active menu shows only its alternative"
);

async function testHomeSwipes(feed: string) {
  await tap(screen.find((node) => node.label === "Following"));
  screen = await snapshot();
  expectSelected(screen, "Following");
  await capture(`home-following-${feed.replaceAll(" ", "-")}`);
  screen = await swipe("right");
  expectSelected(screen, "Latest");
  screen = await swipe("right");
  expectSelected(screen, feed);
  screen = await swipe("right");
  expectSelected(screen, feed);
  screen = await swipe("left");
  expectSelected(screen, "Latest");
  screen = await swipe("left");
  expectSelected(screen, "Following");
  screen = await swipe("left");
  expectSelected(screen, "Following");
  console.log(
    `PASS ${feed}: Following ↔ Latest ↔ discovery, both edges clamped`
  );
  await tap(screen.find((node) => node.label === feed));
  screen = await snapshot();
  expectSelected(screen, feed);
  await tap(screen.find((node) => node.label === feed));
  screen = await snapshot();
  const alternative = feed === "Trending" ? "For you" : "Trending";
  expectMenu(screen, true, alternative);
  await capture(`home-menu-${feed.replaceAll(" ", "-")}`);
  await tap(screen.find((node) => node.label === alternative));
  screen = await snapshot();
  expectSelected(screen, alternative);
}

await testHomeSwipes(firstAlternative);
await testHomeSwipes(initialDiscovery);

viewingGusts = true;
await tap(screen.find((node) => node.label === "Gusts"));
screen = await snapshot();
let gustDiscovery = screen.find((node) =>
  node.label.endsWith(", choose Gusts feed")
);
await tap(screen.find((node) => node.label === "Following Gusts"));
screen = await snapshot();
expectSelected(screen, "Following Gusts");
for (let index = 0; index < 2; index += 1) {
  // oxlint-disable-next-line no-await-in-loop -- drive the current emulator in order
  await tap(gustDiscovery);
  // oxlint-disable-next-line no-await-in-loop -- assert the actual destination
  screen = await snapshot();
  const current = screen.find((node) =>
    node.label.endsWith(", choose Gusts feed")
  );
  expectSelected(screen, current?.label ?? "");
  // oxlint-disable-next-line no-await-in-loop -- second press opens the active menu
  await tap(current);
  // oxlint-disable-next-line no-await-in-loop -- read the menu after it opens
  screen = await snapshot();
  const alternative = current?.label.startsWith("Latest")
    ? "For you"
    : "Latest";
  expectMenu(screen, true, alternative);
  // oxlint-disable-next-line no-await-in-loop -- save each alternative for visual review
  await capture(`gusts-menu-${index}`);
  // oxlint-disable-next-line no-await-in-loop -- select the sole alternative
  await tap(screen.find((node) => node.label === alternative));
  // oxlint-disable-next-line no-await-in-loop -- assert the changed feed
  screen = await snapshot();
  gustDiscovery = screen.find((node) =>
    node.label.endsWith(", choose Gusts feed")
  );
  expectSelected(screen, gustDiscovery?.label ?? "");
  // oxlint-disable-next-line no-await-in-loop -- leave discovery before testing its remembered selection
  await tap(screen.find((node) => node.label === "Following Gusts"));
  // oxlint-disable-next-line no-await-in-loop -- inspect Following before the next iteration
  screen = await snapshot();
  expectSelected(screen, "Following Gusts");
}
console.log(
  "PASS Gusts: Following → remembered discovery; only active discovery opens its alternative"
);
await capture("gusts-following");
await adb("shell", "input", "keyevent", "4");
console.log(`Release feed-tab smoke passed. Screenshots: ${artifactDirectory}`);
