// Checks the installed Android app without changing account or security settings.
// Usage: bun apps/mobile/scripts/native-settings-layout-smoke.ts
// Repeat at a narrower display or larger system font size to check text wrapping.
// oxlint-disable no-await-in-loop -- Each Android action must finish before inspecting or changing the same screen.
import { mkdir } from "node:fs/promises";

const artifactDirectory =
  process.env.ASM_SETTINGS_SMOKE_ARTIFACTS ?? "/tmp/asm-settings-layout-smoke";
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

const sizeOutput = await adb("shell", "wm", "size");
const sizes = [...sizeOutput.matchAll(/(?<width>\d+)x(?<height>\d+)/g)];
const size = sizes.at(-1)?.groups;
if (!size) {
  throw new Error("Cannot read the display size");
}
const width = Number(size.width);
const height = Number(size.height);
const densityOutput = await adb("shell", "wm", "density");
const densities = [...densityOutput.matchAll(/density: (?<density>\d+)/g)];
const density = Number(densities.at(-1)?.groups?.density);
if (!density) {
  throw new Error("Cannot read the display density");
}
const gutter = (16 * density) / 160;

const tabs = [
  { name: "profile", section: "settings-profile" },
  { name: "account", section: "settings-username" },
  { name: "privacy", section: "" },
  { name: "security", section: "settings-two-factor" },
];
let snapshotsChecked = 0;
const checkedLabels = new Set<string>();
for (const tab of tabs) {
  await adb(
    "shell",
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    `'asocialmedia://settings?tab=${tab.name}&section=${tab.section}'`,
    "-n",
    "cc.asocialmedia.mobile/.MainActivity"
  );
  await Bun.sleep(1500);
  // Tabs retain their scroll position, including when a previous run stopped early.
  for (let reset = 0; reset < 4; reset += 1) {
    await adb(
      "shell",
      "input",
      "swipe",
      String(width / 2),
      String(height * 0.42),
      String(width / 2),
      String(height * 0.8),
      "150"
    );
  }
  await Bun.sleep(500);
  for (let page = 0; page < 5; page += 1) {
    const name = `${tab.name}-${page}`;
    const remotePath = "/sdcard/asm-settings-layout-smoke.xml";
    await adb("shell", "rm", "-f", remotePath);
    await adb("shell", "uiautomator", "dump", remotePath);
    const xml = await adb("shell", "cat", remotePath);
    await Bun.write(`${artifactDirectory}/${name}.xml`, xml);
    const nodes = [...xml.matchAll(/<node\s[^>]+>/g)].map(([node]) => ({
      bounds: [
        ...(
          node.match(/bounds="(?<bounds>[^"]+)"/)?.groups?.bounds ?? ""
        ).matchAll(/\d+/g),
      ].map(([number]) => Number(number)),
      isText: node.includes('class="android.widget.TextView"'),
      text: node.match(/text="(?<text>[^"]*)"/)?.groups?.text ?? "",
    }));
    if (!xml.includes("Search settings")) {
      throw new Error("The app is not on Settings");
    }
    const search = nodes.find((node) => node.text === "Search settings");
    const contentTop = search?.bounds[3] ?? height * 0.2;
    for (const node of nodes) {
      const [left = 0, top = 0, right = 0, bottom = 0] = node.bounds;
      if (
        !node.isText ||
        !node.text ||
        top < contentTop ||
        right <= left ||
        bottom <= top
      ) {
        continue;
      }
      checkedLabels.add(node.text);
      if (left < gutter - 2 || right > width - gutter + 2) {
        throw new Error(
          `${tab.name} page ${page}: text extends past the Settings gutter (${left}..${right}, display ${width})`
        );
      }
    }
    snapshotsChecked += 1;
    await adb(
      "shell",
      "input",
      "swipe",
      String(width / 2),
      String(height * 0.8),
      String(width / 2),
      String(height * 0.42),
      "350"
    );
    await Bun.sleep(300);
  }
}
for (const label of [
  "Username",
  "Who can add me to a group",
  "Two-factor authentication",
  "Messages recovery",
  "Active sessions",
  "Refresh",
]) {
  if (!checkedLabels.has(label)) {
    throw new Error(`Expected Settings content was not checked: ${label}`);
  }
}
console.log(
  JSON.stringify({ density, result: "passed", snapshotsChecked, width })
);
