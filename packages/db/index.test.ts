import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("the public database entrypoint bundles without conflicting exports", async () => {
  const result = await Bun.build({
    entrypoints: [fileURLToPath(new URL("index.ts", import.meta.url))],
    packages: "external",
    target: "bun",
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBeGreaterThan(0);
});
