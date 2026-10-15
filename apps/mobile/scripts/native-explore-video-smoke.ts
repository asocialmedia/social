// Checks custom Explore video controls and viewport playback on the installed release.
// Usage: ASM_SMOKE_FAST_DUMP=1 bun apps/mobile/scripts/native-explore-video-smoke.ts
// Requires at least one unmarked video in the public trending feed.
// oxlint-disable no-await-in-loop -- Device actions depend on the preceding screen.
import { mkdir } from "node:fs/promises";

const artifacts =
  process.env.ASM_SMOKE_ARTIFACT_DIRECTORY ?? "/tmp/asm-explore-video-smoke";
const activity = "cc.asocialmedia.mobile/.MainActivity";
await mkdir(artifacts, { recursive: true });

async function adb(...args: string[]) {
  const command = Bun.spawn(["adb", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
    command.exited,
  ]);
  if (code !== 0) {
    throw new Error(`adb ${args[0]} failed: ${stderr}`);
  }
  return stdout;
}

const sizeOutput = await adb("shell", "wm", "size");
const sizes = [...sizeOutput.matchAll(/(?<width>\d+)x(?<height>\d+)/g)];
const size = sizes.at(-1)?.groups;
if (!size) {
  throw new Error("Cannot read emulator dimensions");
}
const width = Number(size.width);
const height = Number(size.height);

async function snapshot(name?: string) {
  const path = "/sdcard/asm-explore-video-smoke.xml";
  await adb("shell", "rm", "-f", path);
  const output =
    process.env.ASM_SMOKE_FAST_DUMP === "1"
      ? await adb(
          "shell",
          "env",
          "CLASSPATH=/data/local/tmp/asm-fast-dump.jar:/system/framework/uiautomator.jar",
          "app_process",
          "/system/bin",
          "AsmFastDump",
          path
        )
      : await adb("shell", "uiautomator", "dump", path);
  if (!output.includes("dumped to:")) {
    throw new Error("Android hierarchy did not settle");
  }
  const xml = await adb("shell", "cat", path);
  if (xml.includes("Something went wrong")) {
    throw new Error("App entered its error boundary");
  }
  if (name) {
    await Bun.write(`${artifacts}/${name}.xml`, xml);
    const capture = Bun.spawn(["adb", "exec-out", "screencap", "-p"], {
      stdout: "pipe",
    });
    await Bun.write(
      `${artifacts}/${name}.png`,
      await new Response(capture.stdout).arrayBuffer()
    );
    if ((await capture.exited) !== 0) {
      throw new Error("Screenshot failed");
    }
  }
  return [...xml.matchAll(/<node\s[^>]+>/g)]
    .map(([node]) => ({
      bounds: [
        ...(
          node.match(/bounds="(?<bounds>[^"]+)"/)?.groups?.bounds ?? ""
        ).matchAll(/-?\d+/g),
      ].map(([value]) => Number(value)),
      label: node.match(/content-desc="(?<label>[^"]*)"/)?.groups?.label ?? "",
      text: node.match(/text="(?<text>[^"]*)"/)?.groups?.text ?? "",
    }))
    .filter(
      ({ bounds: [left = 0, top = 0, right = 0, bottom = 0] }) =>
        right > left &&
        bottom > top &&
        right > 0 &&
        left < width &&
        bottom > 0 &&
        top < height
    );
}

type UiNode = Awaited<ReturnType<typeof snapshot>>[number];

async function waitFor(
  predicate: (screen: UiNode[]) => boolean,
  description: string
) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const screen = await snapshot();
    if (predicate(screen)) {
      return screen;
    }
    await Bun.sleep(500);
  }
  throw new Error(`Did not reach ${description}`);
}

async function open(path: string) {
  await adb(
    "shell",
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    `'asocialmedia://${path}'`,
    "-n",
    activity
  );
  await Bun.sleep(1000);
}

async function swipe(up: boolean) {
  await adb(
    "shell",
    "input",
    "swipe",
    String(width * 0.6),
    String(height * (up ? 0.82 : 0.28)),
    String(width * 0.6),
    String(height * (up ? 0.28 : 0.82)),
    "450"
  );
  await Bun.sleep(600);
}

async function tap(node: UiNode) {
  const [left = 0, top = 0, right = 0, bottom = 0] = node.bounds;
  await adb(
    "shell",
    "input",
    "tap",
    String(Math.round((left + right) / 2)),
    String(Math.round((top + bottom) / 2))
  );
  await Bun.sleep(800);
}

const packageInfo = await adb(
  "shell",
  "dumpsys",
  "package",
  "cc.asocialmedia.mobile"
);
if (packageInfo.includes("DEBUGGABLE")) {
  throw new Error("Requires a release APK");
}
await open("discover?tab=trending");
await waitFor(
  (screen) =>
    screen.some(
      (node) => node.text === "Trending" || node.label === "Trending"
    ),
  "Explore Trending"
);
let playing: UiNode | undefined;
for (let attempt = 0; attempt < 24; attempt += 1) {
  await Bun.sleep(700);
  const screen = await snapshot();
  const players = screen.filter((node) => node.label === "Pause");
  if (players.length > 1) {
    throw new Error("More than one Explore preview is playing");
  }
  [playing] = players;
  if (playing) {
    break;
  }
  await swipe(true);
}
if (!playing) {
  throw new Error(
    "No unmarked video autoplayed in the inspected Trending pages"
  );
}
const clockPattern = /^\d+:\d{2} \/ \d+:\d{2}$/;
const before = await snapshot("autoplay");
await Bun.sleep(1600);
const after = await snapshot("autoplay-advanced");
const clocksBefore = new Set(
  before.filter((node) => clockPattern.test(node.text)).map((node) => node.text)
);
if (
  !after.some(
    (node) => clockPattern.test(node.text) && !clocksBefore.has(node.text)
  )
) {
  throw new Error("The autoplay clock did not advance");
}
const mute = after.find(
  (node) => node.label === "Unmute" || node.label === "Mute"
);
if (!mute) {
  throw new Error("Custom mute control is absent");
}
await tap(mute);
let screen = await snapshot("mute-toggled");
if (
  !screen.some(
    (node) => node.label === (mute.label === "Unmute" ? "Mute" : "Unmute")
  )
) {
  throw new Error("Mute did not toggle within Explore");
}
const restoreMute = screen.find(
  (node) => node.label === (mute.label === "Unmute" ? "Mute" : "Unmute")
);
if (restoreMute) {
  await tap(restoreMute);
}
const beforePause = await snapshot();
const pause = beforePause.find((node) => node.label === "Pause");
if (!pause) {
  throw new Error("Custom pause control is absent");
}
await tap(pause);
screen = await snapshot("paused");
if (screen.some((node) => node.label === "Pause")) {
  throw new Error("Pause navigated away or left the preview playing");
}
const play = screen.find(
  (node) =>
    node.label === "Play" &&
    node.bounds[0] === pause.bounds[0] &&
    node.bounds[1] === pause.bounds[1]
);
if (!play) {
  throw new Error("The paused preview lost its custom play control");
}
await tap(play);
await waitFor(
  (nodes) => nodes.some((node) => node.label === "Pause"),
  "resumed preview"
);
await open("discover?tab=people");
await waitFor(
  (nodes) =>
    nodes.some((node) => node.text === "People" || node.label === "People"),
  "People tab"
);
const people = await snapshot("people-no-playback");
if (people.some((node) => node.label === "Pause")) {
  throw new Error("A hidden Explore feed kept its playback controls active");
}
await open("discover?tab=trending");
await waitFor(
  (nodes) => nodes.some((node) => node.label === "Pause"),
  "restored viewport playback"
);
await snapshot("restored-preview");
await Bun.write(
  `${artifacts}/report.json`,
  JSON.stringify(
    {
      autoplay: true,
      customControls: true,
      manualPauseResume: true,
      muteWithoutNavigation: true,
      onePlayingPreview: true,
      tabRestore: true,
    },
    null,
    2
  )
);
console.log(
  "Passed Explore video autoplay, custom controls, pause/resume, mute, single playback and tab restoration."
);
