export async function adb(...args: string[]): Promise<string> {
  const command = Bun.spawn(["adb", ...args], {
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
    command.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`adb ${args[0]} failed (${exitCode}): ${stderr}`);
  }
  return stdout;
}

export function parseUiNodes(xml: string, signedBounds = false) {
  return [...xml.matchAll(/<node\s[^>]+>/g)].map(([node]) => ({
    bounds: [
      ...(
        node.match(/bounds="(?<bounds>[^"]*)"/)?.groups?.bounds ?? ""
      ).matchAll(signedBounds ? /-?\d+/g : /\d+/g),
    ].map(([value]) => Number(value)),
    isText: node.includes('class="android.widget.TextView"'),
    label: node.match(/content-desc="(?<label>[^"]*)"/)?.groups?.label ?? "",
    resourceId: node.match(/resource-id="(?<id>[^"]*)"/)?.groups?.id ?? "",
    selected: node.includes('selected="true"'),
    text: node.match(/text="(?<text>[^"]*)"/)?.groups?.text ?? "",
  }));
}

export function dumpHierarchy(
  remotePath: string,
  { fast = process.env.ASM_SMOKE_FAST_DUMP === "1", compressed = false } = {}
): Promise<string> {
  return fast
    ? adb(
        "shell",
        "env",
        "CLASSPATH=/data/local/tmp/asm-fast-dump.jar:/system/framework/uiautomator.jar",
        "app_process",
        "/system/bin",
        "AsmFastDump",
        remotePath
      )
    : adb(
        "shell",
        "uiautomator",
        "dump",
        ...(compressed ? ["--compressed"] : []),
        remotePath
      );
}

export async function captureScreenshot(filePath: string): Promise<void> {
  const command = Bun.spawn(["adb", "exec-out", "screencap", "-p"], {
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [image, stderr, exitCode] = await Promise.all([
    new Response(command.stdout).arrayBuffer(),
    new Response(command.stderr).text(),
    command.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Screenshot failed (${exitCode}): ${stderr}`);
  }
  await Bun.write(filePath, image);
}
