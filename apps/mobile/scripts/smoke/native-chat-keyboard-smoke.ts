// Open an unlocked conversation in the installed release app before running.
// Usage: ASM_SMOKE_FAST_DUMP=1 bun apps/mobile/scripts/smoke/native-chat-keyboard-smoke.ts
// Focuses an empty composer without typing or sending a message.
import { adb, dumpHierarchy, parseUiNodes } from "./android";

async function snapshot() {
  const path = "/sdcard/asm-chat-keyboard.xml";
  await adb("shell", "rm", "-f", path);
  await dumpHierarchy(path, { compressed: true });
  const xml = await adb("shell", "cat", path);
  if (!xml.includes('package="cc.asocialmedia.mobile"')) {
    throw new Error("The app lost foreground focus");
  }
  return parseUiNodes(xml);
}
type UiNode = Awaited<ReturnType<typeof snapshot>>[number];

function find(nodes: UiNode[], label: string) {
  const node = nodes.find((item) => item.label === label);
  if (!node || node.bounds.length !== 4) {
    throw new Error(`Open a chat with a visible ${label} before running`);
  }
  return node;
}

async function verifyCycle() {
  const initial = await snapshot();
  const input = find(initial, "Message");
  const header = find(initial, "Back");
  await adb(
    "shell",
    "input",
    "tap",
    String(((input.bounds[0] ?? 0) + (input.bounds[2] ?? 0)) / 2),
    String(((input.bounds[1] ?? 0) + (input.bounds[3] ?? 0)) / 2)
  );
  await Bun.sleep(800);
  const opened = await snapshot();
  const windows = await adb("shell", "dumpsys", "window", "windows");
  const ime = windows
    .split("Window #")
    .find((section) => /Window\{[^}]* InputMethod\}/.test(section));
  const top = Number(
    ime?.match(/touchable region=SkRegion\(\(\d+,(?<top>\d+),/)?.groups?.top
  );
  const inputMethod = await adb("shell", "dumpsys", "input_method");
  if (!top || !inputMethod.includes("mInputShown=true")) {
    throw new Error("Keyboard did not open or its bounds are unavailable");
  }
  const focused = find(opened, "Message");
  const send = find(opened, "Send");
  if (
    (focused.bounds[3] ?? Infinity) > top ||
    (send.bounds[3] ?? Infinity) > top
  ) {
    throw new Error(
      `Composer is obscured: ${JSON.stringify({ input: focused.bounds, keyboardTop: top, send: send.bounds })}`
    );
  }
  if (
    JSON.stringify(find(opened, "Back").bounds) !==
    JSON.stringify(header.bounds)
  ) {
    throw new Error("Keyboard moved the chat header");
  }
  await adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await Bun.sleep(600);
  const dismissed = find(await snapshot(), "Message");
  if (JSON.stringify(dismissed.bounds) !== JSON.stringify(input.bounds)) {
    throw new Error("Composer did not return to its bottom anchor");
  }
  return {
    closed: input.bounds,
    dismissed: dismissed.bounds,
    keyboardTop: top,
    opened: focused.bounds,
    send: send.bounds,
  };
}

const inputMethod = await adb("shell", "dumpsys", "input_method");
if (inputMethod.includes("mInputShown=true")) {
  await adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await Bun.sleep(600);
}
const first = await verifyCycle();
const second = await verifyCycle();
console.log(
  JSON.stringify({ cycles: [first, second], keyboardAvoidance: true }, null, 2)
);
