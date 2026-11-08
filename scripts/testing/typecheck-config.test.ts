import { expect, test } from "bun:test";

test("all type checks run inside Turbo including the root scripts project", async () => {
  const manifest = await Bun.file(
    new URL("../../package.json", import.meta.url)
  ).json();
  const config = await Bun.file(
    new URL("../../turbo.json", import.meta.url)
  ).json();

  expect(manifest.scripts["check-types"]).toMatch(
    /^turbo run check-types check-types:scripts --concurrency=[1-8]$/
  );
  expect(manifest.scripts["check-types:scripts"]).toBe(
    "tsc --project scripts/tsconfig.json"
  );
  expect(config.tasks["//#check-types:scripts"].inputs).toEqual([
    "$TURBO_DEFAULT$",
    "packages/db/generated/**",
  ]);
  expect(config.tasks["check-types"].dependsOn).toContain("typecheck-inputs");
  expect(config.tasks["typecheck-inputs"].dependsOn).toContain(
    "^typecheck-inputs"
  );
  expect(config.tasks["check-types"].inputs).toContain(
    "$TURBO_ROOT$/tsconfig.json"
  );
  expect(config.tasks["check-types"].inputs).toContain(
    "$TURBO_ROOT$/packages/db/generated/**"
  );
});

test("shared TypeScript projects retain compiler state across Turbo cache misses", async () => {
  for (const file of [
    "../../tsconfig.json",
    "../../packages/config/base.tsconfig.json",
    "../../apps/mobile/tsconfig.json",
    "../../apps/mobile/scripts/tsconfig.json",
  ]) {
    const config = Bun.JSONC.parse(
      await Bun.file(new URL(file, import.meta.url)).text()
    );
    expect(config).toMatchObject({ compilerOptions: { incremental: true } });
  }
});
