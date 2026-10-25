import { mkdir } from "node:fs/promises";

// Run from a signed-in Home feed at the top without clearing its account or draft.
// Usage: ASM_SMOKE_FAST_DUMP=1 bun apps/mobile/scripts/smoke/native-media-hold-smoke.ts
// oxlint-disable no-await-in-loop -- Each device action depends on the preceding UI state.
import { adb, captureScreenshot, dumpHierarchy, parseUiNodes } from "./android";

const artifactDirectory =
  process.env.ASM_SMOKE_ARTIFACT_DIRECTORY ?? "/tmp/asm-media-hold-smoke";
await mkdir(artifactDirectory, { recursive: true });

async function snapshot() {
  const path = "/sdcard/asm-media-hold-smoke.xml";
  await adb("shell", "rm", "-f", path);
  const output = await dumpHierarchy(path);
  if (!output.includes("dumped to:")) {
    throw new Error("Android hierarchy did not settle");
  }
  const xml = await adb("shell", "cat", path);
  await Bun.write(`${artifactDirectory}/latest.xml`, xml);
  return parseUiNodes(xml, true);
}

type UiNode = Awaited<ReturnType<typeof snapshot>>[number];

async function waitFor(predicate: (nodes: UiNode[]) => boolean) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const nodes = await snapshot();
    if (predicate(nodes)) {
      return nodes;
    }
    await Bun.sleep(300);
  }
  throw new Error("Expected media drawer or Home editor did not appear");
}

function editor(nodes: UiNode[]) {
  const inputs = nodes.filter((node) => node.label.endsWith("Post text"));
  if (inputs.length !== 1) {
    throw new Error(`Expected one Home editor, found ${inputs.length}`);
  }
  const [input] = inputs;
  if (!input) {
    throw new Error("Home editor is absent");
  }
  return input;
}

async function press(node: UiNode | undefined, hold = false) {
  if (!node || node.bounds.length !== 4) {
    throw new Error("Expected control is absent");
  }
  const [left = 0, top = 0, right = 0, bottom = 0] = node.bounds;
  const x = String(Math.round((left + right) / 2));
  const y = String(Math.round((top + bottom) / 2));
  await (hold
    ? adb("shell", "input", "swipe", x, y, x, y, "850")
    : adb("shell", "input", "tap", x, y));
  await Bun.sleep(500);
}

async function capture(name: string) {
  await captureScreenshot(`${artifactDirectory}/${name}.png`);
}

const initial = await snapshot();
editor(initial);
const originalTab = initial.find(
  (node) =>
    node.selected &&
    ["For you", "Latest", "Following", "Trending"].includes(node.label)
)?.label;
const results: { feed: string; hold: number; editorBounds: number[] }[] = [];
try {
  for (const feed of ["Latest", "For you"]) {
    let nodes = await snapshot();
    if (!nodes.some((node) => node.label === feed && node.selected)) {
      await press(nodes.find((node) => node.label === feed));
      nodes = await waitFor((screen) =>
        screen.some((node) => node.label === feed && node.selected)
      );
    }
    const before = editor(nodes);
    await capture(`${feed}-before`);
    for (let hold = 0; hold < 3; hold += 1) {
      nodes = await snapshot();
      const media = nodes.find(
        (node) =>
          node.label === "Open post media" &&
          (node.bounds[1] ?? 0) > (before.bounds[3] ?? 0)
      );
      await press(media, true);
      nodes = await waitFor((screen) =>
        screen.some((node) => node.label === "Save media")
      );
      await Bun.sleep(700);
      await capture(`${feed}-hold-${hold}`);
      await press(
        nodes.find((node) =>
          ["Close sheet", "Close media preview"].includes(node.label)
        )
      );
      nodes = await waitFor((screen) =>
        screen.some((node) => node.label.endsWith("Post text"))
      );
      const after = editor(nodes);
      if (
        JSON.stringify(after.bounds) !== JSON.stringify(before.bounds) ||
        after.text !== before.text
      ) {
        throw new Error(
          `${feed}: holding media moved the editor or changed its draft`
        );
      }
      if (!nodes.some((node) => node.label === feed && node.selected)) {
        throw new Error("Media hold navigated away from the feed");
      }
      results.push({ editorBounds: after.bounds, feed, hold });
      await Bun.sleep(700);
      await capture(`${feed}-closed-${hold}`);
    }
  }
} finally {
  const nodes = await snapshot();
  if (
    originalTab &&
    !nodes.some((node) => node.label === originalTab && node.selected)
  ) {
    await press(nodes.find((node) => node.label === originalTab));
  }
}
await Bun.write(
  `${artifactDirectory}/result.json`,
  JSON.stringify({ passed: true, results }, null, 2)
);
console.log(
  `Passed ${results.length} media holds: editor position, draft and feed retained.`
);
