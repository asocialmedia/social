import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { adb, captureScreenshot, dumpHierarchy, parseUiNodes } from "./android";

test("hierarchy parsing retains the attributes used by smoke assertions", () => {
  const xml =
    '<hierarchy><node bounds="[-20,10][80,90]" content-desc="Open post" resource-id="post-1" selected="true" text="A post" class="android.widget.TextView"/><node text=""/></hierarchy>';
  expect(parseUiNodes(xml, true)).toEqual([
    {
      bounds: [-20, 10, 80, 90],
      isText: true,
      label: "Open post",
      resourceId: "post-1",
      selected: true,
      text: "A post",
    },
    {
      bounds: [],
      isText: false,
      label: "",
      resourceId: "",
      selected: false,
      text: "",
    },
  ]);
  expect(parseUiNodes(xml)[0]?.bounds).toEqual([20, 10, 80, 90]);
  expect(parseUiNodes("<hierarchy/> ")).toEqual([]);
});

describe.skipIf(process.platform === "win32")(
  "Android command transport",
  () => {
    let directory: string;
    const originalPath = process.env.PATH;

    beforeAll(async () => {
      directory = await mkdtemp(path.join(tmpdir(), "asm-adb-test-"));
      const executable = path.join(directory, "adb");
      await Bun.write(
        executable,
        `#!${process.execPath}
if (process.argv.includes("fail")) {
  console.error("device offline");
  process.exit(7);
}
if (process.argv[2] === "exec-out") {
  process.stdout.write(new Uint8Array([137, 80, 78, 71, 0, 255]));
} else {
  console.log(JSON.stringify(process.argv.slice(2)));
}
`
      );
      await chmod(executable, 0o755);
      process.env.PATH = `${directory}${path.delimiter}${originalPath ?? ""}`;
    });

    afterAll(async () => {
      if (originalPath === undefined) {
        Reflect.deleteProperty(process.env, "PATH");
      } else {
        process.env.PATH = originalPath;
      }
      await rm(directory, { force: true, recursive: true });
    });

    test("retains ordinary and fast hierarchy commands and compression", async () => {
      expect(
        JSON.parse(
          await dumpHierarchy("/sdcard/test.xml", {
            compressed: true,
            fast: false,
          })
        )
      ).toEqual([
        "shell",
        "uiautomator",
        "dump",
        "--compressed",
        "/sdcard/test.xml",
      ]);
      expect(
        JSON.parse(await dumpHierarchy("/sdcard/test.xml", { fast: true }))
      ).toEqual([
        "shell",
        "env",
        "CLASSPATH=/data/local/tmp/asm-fast-dump.jar:/system/framework/uiautomator.jar",
        "app_process",
        "/system/bin",
        "AsmFastDump",
        "/sdcard/test.xml",
      ]);
    });

    test("reports failed commands instead of returning stale output", async () => {
      await expect(adb("fail")).rejects.toThrow(
        "adb fail failed (7): device offline"
      );
    });

    test("writes screenshot bytes without converting them to text", async () => {
      const filePath = path.join(directory, "screen.png");
      await captureScreenshot(filePath);
      expect(new Uint8Array(await Bun.file(filePath).arrayBuffer())).toEqual(
        new Uint8Array([137, 80, 78, 71, 0, 255])
      );
    });
  }
);
