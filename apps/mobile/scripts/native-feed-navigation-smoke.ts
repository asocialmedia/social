// Runs against the already-installed Android release app and real public posts.
// Usage: bun apps/mobile/scripts/native-feed-navigation-smoke.ts
const packageName = "cc.asocialmedia.mobile";

async function adb(...args: string[]): Promise<string> {
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

function nodes(xml: string) {
  return [...xml.matchAll(/<node\s[^>]+>/g)].map(([node]) => ({
    bounds: [
      ...(
        node.match(/bounds="(?<bounds>[^"]+)"/)?.groups?.bounds ?? ""
      ).matchAll(/\d+/g),
    ].map(([value]) => Number(value)),
    label: node.match(/content-desc="(?<label>[^"]*)"/)?.groups?.label ?? "",
    text: node.match(/text="(?<text>[^"]*)"/)?.groups?.text ?? "",
  }));
}

async function snapshot() {
  await adb("shell", "rm", "-f", "/sdcard/asm-navigation-smoke.xml");
  const output = await adb(
    "shell",
    "uiautomator",
    "dump",
    "/sdcard/asm-navigation-smoke.xml"
  );
  if (!output.includes("dumped to:")) {
    throw new Error(
      "Android hierarchy did not reach idle; no stale dump was read"
    );
  }
  const xml = await adb("shell", "cat", "/sdcard/asm-navigation-smoke.xml");
  await Bun.write("/tmp/asm-navigation-smoke.xml", xml);
  if (xml.includes("Something went wrong")) {
    throw new Error("The app entered its error boundary during navigation");
  }
  // The pager keeps neighbouring pages mounted; ignore their off-screen nodes.
  return nodes(xml).filter((node) => {
    const [left = 0, top = 0, right = 0, bottom = 0] = node.bounds;
    return (
      right > left &&
      bottom > top &&
      right > 0 &&
      left < 1280 &&
      bottom > 0 &&
      top < 2856
    );
  });
}

type UiNode = ReturnType<typeof nodes>[number];

async function waitForScreen(
  matches: (screen: UiNode[]) => boolean,
  description: string
) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop -- wait for the actual destination instead of assuming a fixed navigation duration
    const screen = await snapshot();
    if (matches(screen)) {
      return screen;
    }
    // oxlint-disable-next-line no-await-in-loop -- allow the navigator and accessibility tree to settle before retrying
    await Bun.sleep(1000);
  }
  throw new Error(`Navigation did not reach ${description}`);
}

function isHome(screen: UiNode[]) {
  return (
    screen.some((node) => node.text === "Latest") &&
    !screen.some(
      (node) => node.text === "Post" || node.label === "Close viewer"
    )
  );
}

async function tap(node: UiNode | undefined) {
  if (!node || node.bounds.length !== 4) {
    throw new Error("Expected navigation target is absent");
  }
  const [left = 0, top = 0, right = 0, bottom = 0] = node.bounds;
  await adb(
    "shell",
    "input",
    "tap",
    String(Math.round((left + right) / 2)),
    String(Math.round((top + bottom) / 2))
  );
  await Bun.sleep(2000);
}

async function roundTrip(preview: UiNode, previewLabel: string) {
  await tap(preview);
  let screen = await waitForScreen(
    (destination) => destination.some((node) => node.text === "Post"),
    "post detail from the feed preview"
  );
  if (previewLabel === "Open video") {
    await tap(screen.find((node) => node.label === "Play"));
    await Bun.sleep(3000);
    const pidOutput = await adb("shell", "pidof", packageName);
    const pid = pidOutput.trim();
    const threads = await adb("shell", "ps", "-T", "-p", pid);
    if (!threads.includes("MediaCodec_loop")) {
      throw new Error("The detail playback control did not load a decoder");
    }
    // Let playback and detail data settle, then re-read the preview bounds
    // rather than tapping coordinates captured before those updates.
    await Bun.sleep(12_000);
    screen = await snapshot();
  }
  await tap(screen.find((node) => node.label === previewLabel));
  // Let the short public video finish so Android's idle-based dump can settle.
  await Bun.sleep(previewLabel === "Open video" ? 12_000 : 500);
  screen = await waitForScreen(
    (destination) => destination.some((node) => node.label === "Close viewer"),
    "the media viewer from post detail"
  );
  await tap(screen.find((node) => node.label === "Close viewer"));
  screen = await waitForScreen(
    (destination) => destination.some((node) => node.text === "Post"),
    "post detail after closing the viewer"
  );
  await adb("shell", "input", "keyevent", "4");
  await Bun.sleep(previewLabel === "Open video" ? 12_000 : 1500);
  await waitForScreen(isHome, "the home feed after detail Back");
}

await adb("shell", "am", "force-stop", packageName);
await adb("shell", "am", "start", "-W", "-n", `${packageName}/.MainActivity`);
await Bun.sleep(6000);
let home = await waitForScreen(
  (destination) =>
    isHome(destination) ||
    destination.some(
      (node) =>
        node.label === "Go back" ||
        node.label === "Close viewer" ||
        node.text.startsWith("Skip for now")
    ),
  "the restored application screen"
);
for (let attempt = 0; attempt < 3; attempt += 1) {
  if (isHome(home)) {
    break;
  }
  // Cold reopening intentionally restores the last route. Return through its
  // existing controls without clearing any application/session storage.
  const back = home.find(
    (node) =>
      node.label === "Go back" ||
      node.label === "Close viewer" ||
      node.text.startsWith("Skip for now")
  );
  // oxlint-disable-next-line no-await-in-loop -- unwind the restored navigation stack in order
  await tap(back);
  // oxlint-disable-next-line no-await-in-loop -- inspect the destination before the next Back
  home = await snapshot();
}
await tap(home.find((node) => node.text === "Latest"));
const latest = await snapshot();
await Bun.write(
  "/tmp/asm-home-perf/navigation-latest-nodes.json",
  JSON.stringify(latest)
);
const firstImage = latest.find(
  (node) =>
    (node.label === "Open post media" ||
      node.label.startsWith("Parent post by ")) &&
    (node.bounds[2] ?? 0) - (node.bounds[0] ?? 0) > 100 &&
    (node.bounds[3] ?? 0) - (node.bounds[1] ?? 0) > 100 &&
    ((node.bounds[1] ?? 0) + (node.bounds[3] ?? 0)) / 2 < 2100
);
if (!firstImage) {
  throw new Error("Latest needs a real image post for this smoke test");
}
console.log("Image target:", firstImage);
await roundTrip(firstImage, "Open post media");
console.log("PASS image: feed → detail → viewer → detail → feed");

let video: UiNode | undefined;
for (let attempt = 0; attempt < 25; attempt += 1) {
  // The gutter scroll avoids turning an attachment tap into navigation.
  // oxlint-disable-next-line no-await-in-loop -- ordered gestures drive one emulator
  await adb("shell", "input", "swipe", "10", "2050", "10", "750", "400");
  // oxlint-disable-next-line no-await-in-loop -- allow real media and Android idle to settle
  await Bun.sleep(12_000);
  // oxlint-disable-next-line no-await-in-loop -- inspect each successive viewport
  const viewport = await snapshot();
  if (viewport.some((node) => node.text === "Post")) {
    throw new Error("Video search left the home feed during a scroll");
  }
  video = viewport.find(
    (node) => node.label === "Open video" && (node.bounds[1] ?? 0) < 2200
  );
  if (video) {
    break;
  }
}
if (!video) {
  throw new Error("Latest needs a real video post for this smoke test");
}
if ((video.bounds[1] ?? 0) > 1700) {
  await adb("shell", "input", "swipe", "10", "2050", "10", "1050", "450");
  await Bun.sleep(12_000);
  const viewport = await snapshot();
  video = viewport.find((node) => node.label === "Open video");
}
if (!video) {
  throw new Error("Video preview did not remain visible after scrolling");
}
await roundTrip(video, "Open video");
console.log("PASS video: feed → detail → viewer → detail → feed");
const applicationPidOutput = await adb("shell", "pidof", packageName);
const applicationPid = applicationPidOutput.trim();
const nativeErrors = await adb(
  "logcat",
  "-d",
  `--pid=${applicationPid}`,
  "-s",
  "ReactNativeJS:E",
  "AndroidRuntime:E"
);
if (
  nativeErrors.includes("already released") ||
  nativeErrors.includes("FATAL EXCEPTION")
) {
  throw new Error(
    "Navigation accessed a released player or crashed the native activity"
  );
}
console.log(
  "PASS lifecycle: no released-player errors or native activity crash"
);
