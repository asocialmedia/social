// Usage: bun apps/mobile/scripts/native-profile-layout-smoke.ts <username>
// Checks the installed release profile without following, editing, or sending a share.
import { mkdir } from "node:fs/promises";

const username = process.argv.at(2);
if (!username || !/^[\w.-]+$/.test(username)) {
  throw new Error("Pass the username of a profile to inspect");
}
const artifacts = "/tmp/asm-profile-layout-smoke";
await mkdir(artifacts, { recursive: true });

async function adb(...args: string[]) {
  const process = Bun.spawn(["adb", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [output, error, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) {
    throw new Error(`adb ${args[0]} failed: ${error}`);
  }
  return output;
}

function nodes(xml: string) {
  return [...xml.matchAll(/<node\s[^>]+>/g)].map(([node]) => ({
    bounds: [
      ...(
        node.match(/bounds="(?<bounds>[^"]+)"/)?.groups?.bounds ?? ""
      ).matchAll(/\d+/g),
    ].map(([number]) => Number(number)),
    label: node.match(/content-desc="(?<label>[^"]*)"/)?.groups?.label ?? "",
    text: node.match(/text="(?<text>[^"]*)"/)?.groups?.text ?? "",
  }));
}

async function snapshot(name: string) {
  const remote = "/sdcard/asm-profile-layout.xml";
  await adb("shell", "rm", "-f", remote);
  await adb("shell", "uiautomator", "dump", remote);
  const xml = await adb("shell", "cat", remote);
  await Bun.write(`${artifacts}/${name}.xml`, xml);
  await adb("shell", "screencap", "-p", "/sdcard/asm-profile-layout.png");
  await adb(
    "pull",
    "/sdcard/asm-profile-layout.png",
    `${artifacts}/${name}.png`
  );
  return nodes(xml);
}

await adb(
  "shell",
  "am",
  "start",
  "-W",
  "-a",
  "android.intent.action.VIEW",
  "-d",
  `asocialmedia://users/${username}`,
  "-n",
  "cc.asocialmedia.mobile/.MainActivity"
);
await Bun.sleep(2000);
const profile = await snapshot("profile");
const find = (label: string) => {
  const node = profile.find((entry) => entry.label === label);
  if (!node || node.bounds.length !== 4) {
    throw new Error(`Profile control missing: ${label}`);
  }
  return node;
};
const back = find("Go back");
const search = find("Search");
const share = find("Share profile");
const settings = find("Settings");
if (profile.filter((node) => node.label === "Share profile").length !== 1) {
  throw new Error("The profile must have exactly one share control");
}
if (
  !(
    back.bounds[2] < search.bounds[0] &&
    search.bounds[2] <= share.bounds[0] &&
    share.bounds[2] <= settings.bounds[0]
  )
) {
  throw new Error(
    "Top controls must be ordered back, search, share, settings without overlap"
  );
}
if (
  Math.abs(search.bounds[1] - settings.bounds[1]) > 2 ||
  search.bounds[1] !== share.bounds[1]
) {
  throw new Error("The action pill icons must share one horizontal row");
}
const action = profile.find((node) =>
  ["Edit profile", "Follow", "Unfollow"].includes(node.label)
);
const handle = profile.find((node) => node.text === `@${username}`);
if (!action || !handle || action.bounds[1] >= handle.bounds[3]) {
  throw new Error(
    "Edit/follow must align with the identity above the end of the handle"
  );
}
const socials = profile.filter((node) =>
  /^(?:Website|GitHub|LinkedIn|Twitter \/ X|Reddit):/.test(node.label)
);
if (
  socials.some(
    (social) =>
      social.bounds[3] > action.bounds[1] ||
      social.bounds[0] <= handle.bounds[0]
  )
) {
  throw new Error(
    "Social links must sit to the right of the avatar and above the identity actions"
  );
}
async function tap(node: ReturnType<typeof find>) {
  await adb(
    "shell",
    "input",
    "tap",
    String(Math.round((node.bounds[0] + node.bounds[2]) / 2)),
    String(Math.round((node.bounds[1] + node.bounds[3]) / 2))
  );
  await Bun.sleep(600);
}
await tap(search);
const searchScreen = await snapshot("search");
const searchInput = searchScreen.find(
  (node) => node.label === "Search people, posts, and communities"
);
const closeSearch = searchScreen.find((node) => node.label === "Close search");
if (!searchInput || !closeSearch) {
  throw new Error("Search did not open");
}
await tap(closeSearch);
await Bun.sleep(400);
await tap(share);
const shareScreen = await snapshot("share");
if (
  !shareScreen.some((node) =>
    (node.label + node.text).includes(`/users/${username}`)
  )
) {
  throw new Error("The system share sheet must contain the viewed profile URL");
}
await adb("shell", "input", "keyevent", "4");
await Bun.sleep(600);
await tap(settings);
const settingsScreen = await snapshot("settings");
if (!settingsScreen.some((node) => node.text === "Search settings")) {
  throw new Error("The gear must open Settings");
}
await adb("shell", "input", "keyevent", "4");
console.log(
  `Passed profile layout, ${socials.length} social links, search, share URL, and Settings. Artifacts: ${artifacts}`
);
