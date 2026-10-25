import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ensureContainerPolicy } from "./container-policy";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }))
  );
});
async function fixture() {
  const configHome = await mkdtemp(path.join(tmpdir(), "asm-policy-"));
  directories.push(configHome);
  return {
    configHome,
    systemPolicy: path.join(configHome, "system-policy.json"),
  };
}

test("creates a missing policy with only dev registry and local storage access", async () => {
  const options = await fixture();
  const created = await ensureContainerPolicy(options);
  expect(created).toBe(path.join(options.configHome, "containers/policy.json"));
  const policy = JSON.parse(await readFile(created!, "utf8"));
  expect(policy.default).toEqual([{ type: "reject" }]);
  expect(Object.keys(policy.transports.docker)).toEqual([
    "docker.io",
    "public.ecr.aws",
  ]);
  expect(await ensureContainerPolicy(options)).toBeNull();
});

test("preserves an existing user policy byte for byte", async () => {
  const options = await fixture();
  const file = path.join(options.configHome, "containers/policy.json");
  await mkdir(path.dirname(file));
  await writeFile(file, "existing policy");
  expect(await ensureContainerPolicy(options)).toBeNull();
  expect(await readFile(file, "utf8")).toBe("existing policy");
});

test("respects a system policy without creating a user override", async () => {
  const options = await fixture();
  await writeFile(options.systemPolicy, "system policy");
  expect(await ensureContainerPolicy(options)).toBeNull();
  expect(
    await Bun.file(
      path.join(options.configHome, "containers/policy.json")
    ).exists()
  ).toBe(false);
});
