// Checks the installed release app with a populated public community and Explore feed.
// Usage: ASM_SMOKE_FAST_DUMP=1 bun apps/mobile/scripts/native-community-explore-smoke.ts
// The trending feed must contain posts with link, hashtag and mention badges.
// oxlint-disable no-await-in-loop -- Device actions depend on the preceding screen.
import { mkdir } from "node:fs/promises";

const artifacts =
  process.env.ASM_SMOKE_ARTIFACT_DIRECTORY ??
  "/tmp/asm-community-explore-smoke";
const slug = process.env.ASM_SMOKE_COMMUNITY ?? "asocialmedia";
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
  const path = "/sdcard/asm-community-explore-smoke.xml";
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

async function checkPullRefresh(
  message: string,
  anchorText: string,
  name: string
) {
  const before = await snapshot();
  const anchor = before.find((node) => node.text === anchorText);
  if (!anchor) {
    throw new Error(`Missing refresh anchor: ${anchorText}`);
  }
  await adb(
    "shell",
    "input",
    "swipe",
    String(width * 0.5),
    String(height * 0.32),
    String(width * 0.5),
    String(height * 0.8),
    "900"
  );
  await waitFor(
    (screen) => screen.some((node) => node.text === message),
    `${name} refresh confirmation`
  );
  await snapshot(`${name}-refresh`);
  await Bun.sleep(2200);
  const settled = await snapshot();
  const restored = settled.find((node) => node.text === anchorText);
  if (
    !restored ||
    Math.abs((restored.bounds[1] ?? 0) - (anchor.bounds[1] ?? 0)) > 8
  ) {
    throw new Error(
      `${name} did not settle back to its original position after refresh`
    );
  }
}

const communityHeader = (screen: UiNode[]) =>
  screen.find((node) => node.text.startsWith(`a/${slug} ·`));
await open(`a/${encodeURIComponent(slug)}`);
const initialCommunity = await waitFor(
  (screen) =>
    Boolean(communityHeader(screen)) &&
    screen.some((node) => node.label.startsWith("Open post by ")),
  "a populated community"
);
const initialHeaderTop = communityHeader(initialCommunity)?.bounds[1] ?? 0;
await snapshot("community-top");
for (let attempt = 0; attempt < 3; attempt += 1) {
  await swipe(true);
  if (!communityHeader(await snapshot())) {
    break;
  }
}
const scrolled = await snapshot("community-scrolled");
const scrolledHeaderTop = communityHeader(scrolled)?.bounds[1];
if (
  scrolledHeaderTop !== undefined &&
  initialHeaderTop - scrolledHeaderTop < height * 0.015
) {
  throw new Error("Community identity remained pinned while posts scrolled");
}
if (!scrolled.some((node) => node.label.startsWith("Open post by "))) {
  throw new Error("Community posts disappeared while scrolling");
}
for (let attempt = 0; attempt < 4; attempt += 1) {
  await swipe(false);
  const restoredTop = communityHeader(await snapshot())?.bounds[1];
  if (
    restoredTop !== undefined &&
    Math.abs(restoredTop - initialHeaderTop) < 4
  ) {
    break;
  }
}
await waitFor(
  (screen) =>
    Math.abs((communityHeader(screen)?.bounds[1] ?? 0) - initialHeaderTop) < 4,
  "community header after scrolling back"
);
await snapshot("community-restored");
await checkPullRefresh(
  "Community updated",
  communityHeader(initialCommunity)?.text ?? "",
  "community"
);
await open("communities");
await waitFor(
  (screen) => screen.some((node) => node.text === "Discover your"),
  "community directory at the top"
);
await checkPullRefresh(
  "Communities updated",
  "Discover your",
  "community-directory"
);

await open("discover?tab=trending");
await waitFor(
  (screen) => screen.some((node) => node.label.startsWith("Open post by ")),
  "Explore posts"
);
const found = new Set<string>();
let explicitPreview = false;
for (
  let page = 0;
  page < 24 && (found.size < 3 || !explicitPreview);
  page += 1
) {
  const screen = await snapshot();
  const candidates = screen.filter((node) => {
    const top = node.bounds[1] ?? 0;
    const bottom = node.bounds[3] ?? 0;
    return top > height * 0.16 && bottom < height * 0.89;
  });
  if (
    !explicitPreview &&
    candidates.some((node) => node.label === "Blurred explicit media preview")
  ) {
    await Bun.sleep(400);
    await snapshot("explore-explicit");
    explicitPreview = true;
  }
  const tag = candidates.find((node) => node.label.startsWith("Hashtag "));
  const mention = candidates.find((node) =>
    node.label.startsWith("Mentioned user ")
  );
  const link = candidates.find((node) => /, https?:\/\//.test(node.label));
  if (link && !found.has("link")) {
    await snapshot("explore-link");
    await tap(link);
    const deadline = Date.now() + 5000;
    let openedExternal = false;
    while (Date.now() < deadline) {
      const foreground = await adb(
        "shell",
        "dumpsys",
        "activity",
        "activities"
      );
      const resumed = foreground
        .split("\n")
        .filter(
          (line) =>
            line.includes("topResumedActivity") ||
            line.includes("mResumedActivity")
        );
      if (
        resumed.length > 0 &&
        resumed.every((line) => !line.includes("cc.asocialmedia.mobile/"))
      ) {
        openedExternal = true;
        break;
      }
      await Bun.sleep(200);
    }
    if (!openedExternal) {
      throw new Error("Link badge did not open its external destination");
    }
    await adb("shell", "input", "keyevent", "KEYCODE_BACK");
    await Bun.sleep(800);
    found.add("link");
  }
  if (tag && !found.has("tag")) {
    await snapshot("explore-tag");
    await tap(tag);
    const tagName = tag.label.slice("Hashtag ".length);
    await waitFor(
      (nodes) => nodes.some((node) => node.text === `#${tagName}`),
      "hashtag destination from its badge"
    );
    await snapshot("explore-tag-destination");
    await adb("shell", "input", "keyevent", "KEYCODE_BACK");
    await Bun.sleep(800);
    found.add("tag");
  }
  if (mention && !found.has("mention")) {
    await snapshot("explore-mention");
    await tap(mention);
    const username = mention.label.slice("Mentioned user ".length);
    await waitFor(
      (nodes) =>
        nodes.some((node) => node.text === `@${username}`) &&
        !nodes.some((node) => node.text === "Trending"),
      "profile destination from its mention badge"
    );
    await snapshot("explore-mention-destination");
    await adb("shell", "input", "keyevent", "KEYCODE_BACK");
    await Bun.sleep(800);
    found.add("mention");
  }
  if (found.size < 3 || !explicitPreview) {
    await swipe(true);
  }
}
if (found.size !== 3) {
  throw new Error(
    `Explore fixture did not expose all three badge types; found ${[...found].join(", ")}`
  );
}
if (!explicitPreview) {
  throw new Error(
    "Explore fixture did not expose a concealed explicit media preview"
  );
}
const report = {
  communityHeaderReturns: true,
  communityHeaderScrolls: true,
  communityPullRefresh: true,
  directoryPullRefresh: true,
  explicitPreviewConcealed: explicitPreview,
  exploreBadgeDestinations: [...found],
};
await Bun.write(`${artifacts}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
