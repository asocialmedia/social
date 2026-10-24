import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { readConfig } from "./config";
import { loadProtocolsEnvironment } from "./load-env";

let directory = "";
let appDirectory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "asm-protocols-env-"));
  appDirectory = path.join(directory, "apps/protocols");
  await mkdir(appDirectory, { recursive: true });
  await writeFile(
    path.join(directory, ".env"),
    "REDIS_URL=redis://root:6379\nROOT_ONLY=secret\n"
  );
  await writeFile(
    path.join(appDirectory, ".env.development"),
    "PROTOCOLS_PORT=3012\nREDIS_URL=redis://default:6379\nPROTOCOLS_INTERNAL_TOKEN=asm_protocols_development_only_replace_in_production\n"
  );
});

afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

test("loads development defaults without replacing injected values or root secrets", () => {
  const env: Record<string, string | undefined> = { PROTOCOLS_PORT: "3013" };
  loadProtocolsEnvironment({ appDirectory, env });
  expect(env.NODE_ENV).toBe("development");
  expect(env.PROTOCOLS_PORT).toBe("3013");
  expect(env.REDIS_URL).toBe("redis://root:6379");
  expect(env.ROOT_ONLY).toBe("secret");
  expect(env.PROTOCOLS_INTERNAL_TOKEN).toBeDefined();
});

test("local secrets override the root file while injected values keep priority", async () => {
  await writeFile(
    path.join(appDirectory, ".env.local"),
    "REDIS_URL=redis://local:6379\nPROTOCOLS_PORT=3014\n"
  );
  const env: Record<string, string | undefined> = { PROTOCOLS_PORT: "3013" };
  loadProtocolsEnvironment({ appDirectory, env });
  expect(env.REDIS_URL).toBe("redis://local:6379");
  expect(env.PROTOCOLS_PORT).toBe("3013");
});

test("production never falls back to a development credential", () => {
  const env: Record<string, string | undefined> = { NODE_ENV: "production" };
  loadProtocolsEnvironment({ appDirectory, env });
  expect(env.PROTOCOLS_INTERNAL_TOKEN).toBeUndefined();
  expect(env.PROTOCOLS_PORT).toBeUndefined();
  expect(() =>
    readConfig({
      ...env,
      PROTOCOLS_INTERNAL_TOKEN:
        "asm_protocols_development_only_replace_in_production",
    })
  ).toThrow("unique");
});
