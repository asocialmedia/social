import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadRootEnv } from "./index";

let temporaryRoot = "";

describe("loadRootEnv", () => {
  const originalCwd = process.cwd();
  const originalVars = new Map<string, string | undefined>();

  beforeEach(() => {
    temporaryRoot = mkdtempSync(path.join(tmpdir(), "asm-auth-env-"));
    for (const key of ["TEST_AUTH_ENV_A", "TEST_AUTH_ENV_B", "NODE_ENV"]) {
      originalVars.set(key, process.env[key]);
    }
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(temporaryRoot, { force: true, recursive: true });
    for (const [key, value] of originalVars) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  });

  test("loads root .env from a parent directory", async () => {
    const appDir = `${temporaryRoot}/parent/app`;
    mkdirSync(appDir, { recursive: true });
    await Bun.write(`${temporaryRoot}/parent/.env`, "TEST_AUTH_ENV_A=hello\n");
    process.chdir(appDir);
    delete process.env.TEST_AUTH_ENV_A;

    loadRootEnv();

    expect(process.env.TEST_AUTH_ENV_A as string | undefined).toBe("hello");
  });

  test("loads the app-specific .env.<NODE_ENV> file", async () => {
    await Bun.write(
      `${temporaryRoot}/.env.development`,
      "TEST_AUTH_ENV_B=world\n"
    );
    process.chdir(temporaryRoot);
    process.env.NODE_ENV = "development";
    delete process.env.TEST_AUTH_ENV_B;

    loadRootEnv();

    expect(process.env.TEST_AUTH_ENV_B as string | undefined).toBe("world");
  });

  test("loads both root .env and app .env.<NODE_ENV>", async () => {
    await Bun.write(`${temporaryRoot}/.env`, "TEST_AUTH_ENV_A=root\n");
    await Bun.write(
      `${temporaryRoot}/.env.development`,
      "TEST_AUTH_ENV_B=env\n"
    );
    process.chdir(temporaryRoot);
    process.env.NODE_ENV = "development";
    delete process.env.TEST_AUTH_ENV_A;
    delete process.env.TEST_AUTH_ENV_B;

    loadRootEnv();

    expect(process.env.TEST_AUTH_ENV_A as string | undefined).toBe("root");
    expect(process.env.TEST_AUTH_ENV_B as string | undefined).toBe("env");
  });

  test("empty placeholder in app env does not wipe the root value", async () => {
    await Bun.write(`${temporaryRoot}/.env`, "TEST_AUTH_ENV_A=real-secret\n");
    await Bun.write(`${temporaryRoot}/.env.development`, "TEST_AUTH_ENV_A=\n");
    process.chdir(temporaryRoot);
    process.env.NODE_ENV = "development";
    delete process.env.TEST_AUTH_ENV_A;

    loadRootEnv();

    expect(process.env.TEST_AUTH_ENV_A as string | undefined).toBe(
      "real-secret"
    );
  });

  test("does nothing when no env files exist", () => {
    const emptyDir = path.join(temporaryRoot, "empty");
    mkdirSync(emptyDir);
    process.chdir(emptyDir);
    process.env.NODE_ENV = "development";
    delete process.env.TEST_AUTH_ENV_A;
    delete process.env.TEST_AUTH_ENV_B;

    loadRootEnv();

    expect(process.env.TEST_AUTH_ENV_A).toBeUndefined();
    expect(process.env.TEST_AUTH_ENV_B).toBeUndefined();
  });
});
