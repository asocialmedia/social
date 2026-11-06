import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test.each(["development", "production"])(
  "%s defaults to zero remote classification requests",
  async (mode) => {
    const directory = await mkdtemp(path.join(tmpdir(), "asm-clef-settings-"));
    const moduleUrl = new URL("env.ts", import.meta.url).href;
    try {
      for (const [value, enabled, externalValue, externalEnabled] of [
        [undefined, false, undefined, false],
        ["0", false, "1", false],
        ["1", true, undefined, false],
        ["1", true, "0", false],
        ["1", true, "1", true],
      ] as const) {
        const child = Bun.spawn(
          [
            process.execPath,
            "-e",
            `import { workerEnv } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify([workerEnv.CLEF_ENABLED, workerEnv.EXTERNAL_CLEF_ENABLED]));`,
          ],
          {
            cwd: directory,
            env: {
              ...process.env,
              MEDIA_CLEF_ENABLED: value,
              MEDIA_EXTERNAL_CLEF_ENABLED: externalValue,
              NODE_ENV: mode,
            },
            stderr: "pipe",
            stdout: "pipe",
          }
        );
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout.trim())).toEqual([enabled, externalEnabled]);
        expect(exitCode).toBe(0);
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
);
