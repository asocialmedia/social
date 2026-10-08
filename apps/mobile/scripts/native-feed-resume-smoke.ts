// Run against an installed release APK with real feed posts.
// Usage: ASM_SMOKE_FEED_TAB='For you' bun apps/mobile/scripts/native-feed-resume-smoke.ts
const packageName = "cc.asocialmedia.mobile";
const feedTab = process.env.ASM_SMOKE_FEED_TAB ?? "Latest";
if (!["Latest", "For you", "Following", "Trending"].includes(feedTab)) {
  throw new Error("Unknown ASM_SMOKE_FEED_TAB");
}

async function adb(...args: string[]): Promise<string> {
  const process = Bun.spawn(["adb", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) {
    throw new Error(`ADB ${args[0]} failed: ${stderr}`);
  }
  return stdout;
}

const displaySize = await adb("shell", "wm", "size");
const dimensions = displaySize.match(
  /Physical size: (?<width>\d+)x(?<height>\d+)/
);
const width = Number(dimensions?.groups?.width);
const height = Number(dimensions?.groups?.height);
if (!width || !height) {
  throw new Error("Cannot read emulator dimensions");
}

function readNodes(xml: string) {
  return [...xml.matchAll(/<node\s[^>]+>/g)]
    .map(([node]) => ({
      bounds: [
        ...(
          node.match(/bounds="(?<bounds>[^"]*)"/)?.groups?.bounds ?? ""
        ).matchAll(/\d+/g),
      ].map(([value]) => Number(value)),
      label: node.match(/content-desc="(?<label>[^"]*)"/)?.groups?.label ?? "",
      text: node.match(/text="(?<text>[^"]*)"/)?.groups?.text ?? "",
    }))
    .filter(
      ({ bounds: [left = 0, top = 0, right = 0, bottom = 0] }) =>
        right > left &&
        bottom > top &&
        left < width &&
        right > 0 &&
        top < height &&
        bottom > 0
    );
}
type UiNode = ReturnType<typeof readNodes>[number];

async function snapshot() {
  const hierarchyPath = "/sdcard/asm-feed-resume.xml";
  await adb("shell", "rm", "-f", hierarchyPath);
  const result = await adb(
    "shell",
    "uiautomator",
    "dump",
    "--compressed",
    hierarchyPath
  );
  if (!result.includes("dumped to:")) {
    throw new Error("Android hierarchy did not settle; no stale dump was read");
  }
  const xml = await adb("shell", "cat", hierarchyPath);
  if (!xml.includes(`package="${packageName}"`)) {
    throw new Error("The release app lost foreground focus during the test");
  }
  if (xml.includes("Something went wrong")) {
    throw new Error("Application error boundary appeared");
  }
  return readNodes(xml);
}

async function tap(node: UiNode | undefined) {
  if (!node) {
    throw new Error("Expected a visible navigation target");
  }
  const [left = 0, top = 0, right = 0, bottom = 0] = node.bounds;
  await adb(
    "shell",
    "input",
    "tap",
    String(Math.round((left + right) / 2)),
    String(Math.round((top + bottom) / 2))
  );
}

async function screenshot(label: string) {
  await adb("shell", "screencap", "-p", "/sdcard/asm-feed-resume.png");
  await adb(
    "pull",
    "/sdcard/asm-feed-resume.png",
    `/tmp/asm-feed-resume-${label}.png`
  );
}

function assertAnchor(screen: UiNode[], anchor: UiNode, description: string) {
  const matches = screen.filter((node) => node.label === anchor.label);
  if (
    !matches.some(
      (node) => Math.abs((node.bounds[1] ?? 0) - (anchor.bounds[1] ?? 0)) <= 24
    )
  ) {
    throw new Error(
      `${description}: the feed row did not return to its saved position`
    );
  }
}

await adb("shell", "am", "start", "-W", "-n", `${packageName}/.MainActivity`);
let home = await snapshot();
await tap(home.find((node) => node.label === feedTab));
for (let step = 0; step < 3; step += 1) {
  // oxlint-disable-next-line no-await-in-loop -- sequential gestures on one device
  await adb(
    "shell",
    "input",
    "swipe",
    "10",
    String(Math.round(height * 0.7)),
    "10",
    String(Math.round(height * 0.3)),
    "450"
  );
}
await screenshot("hidden");
// Let the last fling reach idle before measuring a deliberate direction change.
await snapshot();
// A small slow reverse drag must reveal the dock while still deep in the feed.
await adb(
  "shell",
  "input",
  "swipe",
  "10",
  String(Math.round(height * 0.4)),
  "10",
  String(Math.round(height * 0.48)),
  "1000"
);
home = await snapshot();
const dock = home.find(
  (node) => node.label === "Home" && (node.bounds[1] ?? height) < height - 160
);
if (!dock) {
  throw new Error("Bottom dock did not reveal after a short upward scroll");
}
await screenshot("revealed");
console.log("PASS dock reveals on a short upward drag deep in the feed");

const anchor = home.find(
  (node) =>
    node.label.startsWith("Open post by ") &&
    (node.bounds[1] ?? 0) > height * 0.15 &&
    (node.bounds[1] ?? height) < height * 0.55 &&
    (node.bounds[3] ?? 0) - (node.bounds[1] ?? 0) > 230
);
if (!anchor) {
  throw new Error(
    `${feedTab} needs a visible real post row for the navigation test`
  );
}
// Tap the card rail below its avatar, away from links and action controls.
await adb(
  "shell",
  "input",
  "tap",
  String(Math.round(width * 0.08)),
  String(Math.round((anchor.bounds[1] ?? 0) + 170))
);
const detail = await snapshot();
if (!detail.some((node) => node.label === "Go back" || node.text === "Post")) {
  throw new Error("Post tap did not reach detail");
}
await adb("shell", "input", "keyevent", "KEYCODE_BACK");
home = await snapshot();
assertAnchor(home, anchor, "Detail Back");
console.log("PASS post detail Back preserves the feed row position");

for (const tab of ["Trending", "For you", "Following", "Latest", feedTab]) {
  // oxlint-disable-next-line no-await-in-loop -- inspect and tap the current page in order
  await tap(home.find((node) => node.label === tab));
  // oxlint-disable-next-line no-await-in-loop -- wait for the native accessibility tree to settle
  home = await snapshot();
}
assertAnchor(home, anchor, "Feed tab round trip");
console.log(`PASS feed tab round trip preserves ${feedTab} position`);

await adb("shell", "input", "keyevent", "KEYCODE_HOME");
await adb("shell", "am", "start", "-W", "-n", `${packageName}/.MainActivity`);
home = await snapshot();
assertAnchor(home, anchor, "Foreground resume");
await screenshot("resumed");
console.log("PASS foreground resume preserves the feed row position");

await tap(home.find((node) => node.label === "Explore"));
const explore = await snapshot();
await tap(explore.find((node) => node.label === "Home"));
home = await snapshot();
assertAnchor(home, anchor, "Dock Home return");
console.log("PASS dock Home reuses the existing feed and scroll position");

const pidOutput = await adb("shell", "pidof", packageName);
const pid = pidOutput.trim();
const errors = await adb(
  "logcat",
  "-d",
  `--pid=${pid}`,
  "-s",
  "ReactNativeJS:E",
  "AndroidRuntime:E"
);
if (errors.includes("FATAL EXCEPTION") || errors.includes("already released")) {
  throw new Error(
    "Release navigation crashed or accessed a released media player"
  );
}
console.log(
  "PASS release lifecycle has no native crash or released-player errors"
);
