// Usage: bun apps/mobile/scripts/native-profile-badges-smoke.ts <username> <community-slug>
// Opens badge details, dismisses them, and follows a community link without mutations.
import { mkdir } from "node:fs/promises";

const username = process.argv.at(2);
const communitySlug = process.argv.at(3);
if (
  !username ||
  !communitySlug ||
  ![username, communitySlug].every((value) => /^[\w.-]+$/.test(value))
) {
  throw new Error("Pass a profile username and one of its community slugs");
}
const artifacts = "/tmp/asm-profile-badges-smoke";
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
  const remote = "/sdcard/asm-profile-badges.xml";
  await adb("shell", "uiautomator", "dump", remote);
  const xml = await adb("shell", "cat", remote);
  await Bun.write(`${artifacts}/${name}.xml`, xml);
  return nodes(xml);
}

async function screenshot(name: string) {
  await adb("shell", "screencap", "-p", "/sdcard/asm-profile-badges.png");
  await adb(
    "pull",
    "/sdcard/asm-profile-badges.png",
    `${artifacts}/${name}.png`
  );
}

async function tap(node: ReturnType<typeof nodes>[number] | undefined) {
  if (!node || node.bounds.length !== 4) {
    throw new Error("Expected tappable badge or community link");
  }
  await adb(
    "shell",
    "input",
    "tap",
    String(Math.round((node.bounds[0] + node.bounds[2]) / 2)),
    String(Math.round((node.bounds[1] + node.bounds[3]) / 2))
  );
}

async function waitForSnapshot(
  name: string,
  ready: (current: ReturnType<typeof nodes>) => boolean,
  attempt = 0
): Promise<ReturnType<typeof nodes>> {
  const current = await snapshot(name);
  if (ready(current) || attempt >= 8) {
    return current;
  }
  await Bun.sleep(500);
  return waitForSnapshot(name, ready, attempt + 1);
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
const profile = await waitForSnapshot("profile", (current) =>
  current.some((node) => node.label === `Open a/${communitySlug}`)
);
const badges = profile.filter((node) => node.label === "Show all badges");
if (badges.length < 2) {
  throw new Error(
    "Profile must expose both the account rail and a community role badge"
  );
}
if (!profile.some((node) => node.label === `Open a/${communitySlug}`)) {
  throw new Error("Community indicator is missing");
}
await screenshot("profile");

await tap(badges[0]);
const details = await snapshot("account-details");
if (
  !details.some((node) => node.text === "Badges") ||
  !details.some(
    (node) =>
      /community/.test(node.text) &&
      node.text !== "Account badges and community roles."
  )
) {
  throw new Error("Badge dialog must explain the account's community roles");
}
if (!details.some((node) => node.label === `Open a/${communitySlug}`)) {
  throw new Error("Badge dialog lost its community link");
}
await screenshot("account-details");
await adb("shell", "input", "keyevent", "4");
const dismissed = await snapshot("dismissed");
if (
  !dismissed.some((node) => node.text === `@${username}`) ||
  dismissed.some((node) => node.text === "Badges")
) {
  throw new Error("Back must dismiss badge details and retain the profile");
}

await tap(badges[1]);
const roleDetails = await snapshot("role-details");
if (!roleDetails.some((node) => node.text === "Badges")) {
  throw new Error("Community role badge must open its details");
}
await screenshot("role-details");
await tap(roleDetails.find((node) => node.label === `Open a/${communitySlug}`));
const community = await waitForSnapshot("community", (current) =>
  current.some((node) => node.text.startsWith(`a/${communitySlug} ·`))
);
if (
  !community.some((node) => node.text.startsWith(`a/${communitySlug} ·`)) ||
  community.some((node) => node.text === "Badges")
) {
  throw new Error(
    "Community link must close the badge dialog and open the community"
  );
}
await screenshot("community");
await adb("shell", "input", "keyevent", "4");
const returned = await snapshot("returned");
if (!returned.some((node) => node.text === `@${username}`)) {
  throw new Error("Community navigation must return to the same profile");
}
const postBadge = returned
  .filter((node) => node.label === "Show all badges")
  .at(2);
await tap(postBadge);
const postDetails = await snapshot("post-badge-details");
if (!postDetails.some((node) => node.text === "Badges")) {
  throw new Error("Badges inside a post must open their explanation");
}
await adb("shell", "input", "keyevent", "4");
const afterPostBadge = await snapshot("post-badge-dismissed");
if (!afterPostBadge.some((node) => node.label === `Open a/${communitySlug}`)) {
  throw new Error(
    "Tapping a post badge must not open its parent post or profile"
  );
}

console.log(
  JSON.stringify({
    accountDetails: true,
    artifacts,
    communityDetails: true,
    communityNavigation: true,
    dismissalRetainsProfile: true,
    postBadgeStopsParentNavigation: true,
  })
);
