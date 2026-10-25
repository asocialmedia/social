// Usage: bun apps/mobile/scripts/smoke/native-gust-paging-smoke.ts latest [--continuous] [--speed] [--eddies]
// Set ASM_SMOKE_FAST_DUMP=1 for the installed AsmFastDump helper and --continuous.
// Verifies direct reversals on the installed release without clearing account data.
import { mkdir } from "node:fs/promises";

const packageName = "cc.asocialmedia.mobile";
const tab = process.argv[2] ?? "following";
if (!["latest", "personalized", "following"].includes(tab)) {
  throw new Error("Expected latest, personalized or following");
}
const artifactDirectory = `/tmp/asm-gust-paging-${tab}`;
await mkdir(artifactDirectory, { recursive: true });

async function adb(...args: string[]) {
  const process = Bun.spawn(["adb", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code) {
    throw new Error(`adb ${args[0]} failed: ${stderr}`);
  }
  return stdout;
}

const sizeOutput = await adb("shell", "wm", "size");
const size = sizeOutput.match(/(?<width>\d+)x(?<height>\d+)/);
const width = Number(size?.groups?.width);
const height = Number(size?.groups?.height);
if (!width || !height) {
  throw new Error("Cannot read screen size");
}
const packageInfo = await adb("shell", "dumpsys", "package", packageName);
if (packageInfo.includes("DEBUGGABLE")) {
  throw new Error("Requires a release APK");
}

async function capture(name: string) {
  const process = Bun.spawn(["adb", "exec-out", "screencap", "-p"], {
    stdout: "pipe",
  });
  await Bun.write(
    `${artifactDirectory}/${name}.png`,
    await new Response(process.stdout).arrayBuffer()
  );
  if (await process.exited) {
    throw new Error("Screenshot failed");
  }
}

const fastDump = process.env.ASM_SMOKE_FAST_DUMP === "1";
if (
  ["--continuous", "--speed", "--eddies"].some((flag) =>
    process.argv.includes(flag)
  ) &&
  !fastDump
) {
  throw new Error(
    "Continuous checks require ASM_SMOKE_FAST_DUMP=1 to inspect playing Gusts without pausing"
  );
}

async function settledCard(name: string, delay = 800) {
  await Bun.sleep(delay);
  const path = "/sdcard/asm-gust-paging.xml";
  await adb("shell", "rm", "-f", path);
  let dump = fastDump
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
  if (!fastDump && !dump.includes("dumped to:")) {
    // Pause moving captions and playback so UIAutomator can reach idle.
    await adb(
      "shell",
      "input",
      "tap",
      String(width * 0.45),
      String(height * 0.4)
    );
    await Bun.sleep(600);
    dump = await adb("shell", "uiautomator", "dump", path);
  }
  if (!dump.includes("dumped to:")) {
    throw new Error(
      "Cannot inspect the current Gust; no stale hierarchy was read"
    );
  }
  const xml = await adb("shell", "cat", path);
  await Bun.write(`${artifactDirectory}/${name}.xml`, xml);
  await capture(name);
  const cards = [...xml.matchAll(/<node\s[^>]+>/g)].flatMap(([node]) => {
    const id = node.match(/resource-id="gust-card-(?<id>[^"]+)"/)?.groups?.id;
    if (!id) {
      return [];
    }
    const bounds = [
      ...(
        node.match(/bounds="(?<bounds>[^"]+)"/)?.groups?.bounds ?? ""
      ).matchAll(/\d+/g),
    ].map(([v]) => Number(v));
    const [, top = 0, , bottom = 0] = bounds;
    return [{ id, visibleHeight: bottom - top }];
  });
  const settled = cards.find((card) => card.visibleHeight >= height * 0.97);
  if (!settled) {
    throw new Error(
      `The reel did not settle on one Gust after ${name}: ${JSON.stringify(cards)}`
    );
  }
  console.log(`Settled on ${name}`);
  return settled.id;
}

async function swipe(direction: "next" | "previous") {
  const lower = String(Math.round(height * 0.67));
  const upper = String(Math.round(height * 0.27));
  await adb(
    "shell",
    "input",
    "swipe",
    String(width * 0.45),
    direction === "next" ? lower : upper,
    String(width * 0.45),
    direction === "next" ? upper : lower,
    "300"
  );
}

await adb("shell", "am", "force-stop", packageName);
await adb(
  "shell",
  "am",
  "start",
  "-W",
  "-n",
  `${packageName}/.MainActivity`,
  "-a",
  "android.intent.action.VIEW",
  "-d",
  `asocialmedia://gusts?tab=${tab}`
);
await Bun.sleep(4000);
const first = await settledCard("first");
if (process.argv.includes("--eddies")) {
  const tapControl = async (name: string, label: string) => {
    const xml = await Bun.file(`${artifactDirectory}/${name}.xml`).text();
    const node = [...xml.matchAll(/<node\s[^>]+>/g)].find(([entry]) =>
      entry.includes(`content-desc="${label}"`)
    )?.[0];
    const bounds = [
      ...(
        node?.match(/bounds="(?<bounds>[^"]+)"/)?.groups?.bounds ?? ""
      ).matchAll(/\d+/g),
    ].map(([value]) => Number(value));
    if (bounds.length !== 4) {
      throw new Error(`${label} control is absent`);
    }
    const [left = 0, top = 0, right = 0, bottom = 0] = bounds;
    await adb(
      "shell",
      "input",
      "tap",
      String((left + right) / 2),
      String((top + bottom) / 2)
    );
  };
  await tapControl("first", "Open eddies");
  if ((await settledCard("eddies-open")) !== first) {
    throw new Error("Opening eddies changed the active Gust");
  }
  for (const direction of ["next", "previous"] as const) {
    const upper = String(Math.round(height * 0.15));
    const lower = String(Math.round(height * 0.43));
    // oxlint-disable-next-line no-await-in-loop -- verify both directions over the exposed card while the sheet remains open
    await adb(
      "shell",
      "input",
      "swipe",
      String(width * 0.45),
      direction === "next" ? lower : upper,
      String(width * 0.45),
      direction === "next" ? upper : lower,
      "300"
    );
    const name = `eddies-${direction}`;
    // oxlint-disable-next-line no-await-in-loop -- inspect the active card after each blocked swipe
    if ((await settledCard(name)) !== first) {
      throw new Error(
        `${direction} swipe moved the reel while eddies were open`
      );
    }
    // oxlint-disable-next-line no-await-in-loop -- assert the sheet remained mounted for the full regression check
    const xml = await Bun.file(`${artifactDirectory}/${name}.xml`).text();
    if (!xml.includes('resource-id="gust-eddies-sheet"')) {
      throw new Error("The eddies sheet closed during the blocked swipe check");
    }
  }
  await tapControl("eddies-previous", "Close eddies");
  if ((await settledCard("eddies-closed")) !== first) {
    throw new Error("Closing eddies changed the active Gust");
  }
  const closed = await Bun.file(
    `${artifactDirectory}/eddies-closed.xml`
  ).text();
  if (closed.includes('resource-id="gust-eddies-sheet"')) {
    throw new Error("The eddies sheet did not close");
  }
  console.log(
    "PASS eddies keep the active Gust fixed during swipes over the exposed card"
  );
}
if (process.argv.includes("--speed")) {
  const x = String(Math.round(width * 0.45));
  const y = String(Math.round(height * 0.4));
  const holding = adb("shell", "input", "swipe", x, y, x, y, "6000");
  try {
    await Bun.sleep(1000);
    if ((await settledCard("speed-held", 0)) !== first) {
      throw new Error("Holding changed the active Gust");
    }
    const held = await Bun.file(`${artifactDirectory}/speed-held.xml`).text();
    if (!held.includes('resource-id="gust-speed-boost"')) {
      throw new Error(
        "The native player did not report 2× speed during the hold"
      );
    }
  } finally {
    await holding;
  }
  if ((await settledCard("speed-released")) !== first) {
    throw new Error("Releasing the hold changed the active Gust");
  }
  const released = await Bun.file(
    `${artifactDirectory}/speed-released.xml`
  ).text();
  if (
    released.includes('resource-id="gust-speed-boost"') ||
    !released.includes('content-desc="Pause gust"')
  ) {
    throw new Error(
      "Releasing did not restore normal speed with playback continuing"
    );
  }
  console.log(
    "PASS hold reports 2× speed; release restores normal speed without a playback tap"
  );
}
if (process.argv.includes("--continuous")) {
  const directions = [
    "next",
    "next",
    "previous",
    "previous",
    "next",
    "previous",
  ] as const;
  const pages = [first];
  for (const [index, direction] of directions.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- preserve the uninterrupted gesture sequence
    await swipe(direction);
    // oxlint-disable-next-line no-await-in-loop -- wait only for snapping, without a playback tap or hierarchy query
    await Bun.sleep(900);
    // oxlint-disable-next-line no-await-in-loop -- inspect each page without waiting for idle or pausing playback
    const current = await settledCard(`continuous-${index}-${direction}`, 0);
    if (index < 2) {
      if (pages.includes(current)) {
        throw new Error(
          `Continuous forward swipe ${index + 1} did not advance`
        );
      }
      pages.push(current);
    } else {
      const expected = pages[index === 2 || index === 4 ? 1 : 0];
      if (current !== expected) {
        throw new Error(
          `Continuous ${direction} swipe ${index + 1} reached the wrong Gust`
        );
      }
    }
  }
  if ((await settledCard("continuous-final")) !== first) {
    throw new Error(
      "Continuous direction reversals did not return to the first Gust"
    );
  }
  console.log(
    `PASS ${tab}: six continuous paging gestures with playback running and no intermediate taps`
  );
  process.exit(0);
}
await swipe("next");
const second = await settledCard("second");
if (second === first) {
  throw new Error("Forward paging did not advance");
}
await swipe("next");
const third = await settledCard("third");
if ([first, second].includes(third)) {
  throw new Error("A second forward swipe did not advance");
}
await swipe("previous");
if ((await settledCard("reverse-to-second")) !== second) {
  throw new Error("Direct reversal did not return to the second Gust");
}
await swipe("previous");
if ((await settledCard("reverse-to-first")) !== first) {
  throw new Error("A second reverse swipe did not return to the first Gust");
}
await swipe("next");
if ((await settledCard("next-again")) !== second) {
  throw new Error(
    "Forward paging after a reversal did not return to the second Gust"
  );
}
await swipe("previous");
if ((await settledCard("reverse-again")) !== first) {
  throw new Error("Repeated direct reversal did not return to the first Gust");
}
console.log(
  `PASS ${tab}: forward twice, reverse twice, forward and reverse again without a preparatory nudge`
);
console.log(`Screenshots and hierarchies: ${artifactDirectory}`);
