import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadRootEnv } from "./index";

const TMP_ROOT = "/tmp/opencode/env-load-test";

describe("loadRootEnv", () => {
  const originalCwd = process.cwd();
  const originalVars = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ["TEST_AUTH_ENV_A", "TEST_AUTH_ENV_B", "NODE_ENV"]) {
      originalVars.set(key, process.env[key]);
    }
  });

  afterEach(() => {
    process.chdir(originalCwd);
    for (const [key, value] of originalVars) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("loads root .env from a parent directory", async () => {
    const appDir = `${TMP_ROOT}/parent/app`;
    await Bun.$`rm -rf ${TMP_ROOT}`.quiet();
    await Bun.$`mkdir -p ${appDir}`.quiet();
    await Bun.write(`${TMP_ROOT}/parent/.env`, "TEST_AUTH_ENV_A=hello\n");
    process.chdir(appDir);
    delete process.env.TEST_AUTH_ENV_A;

    loadRootEnv();

    expect(process.env.TEST_AUTH_ENV_A as string | undefined).toBe("hello");
  });

  test("loads the app-specific .env.<NODE_ENV> file", async () => {
    await Bun.$`rm -rf ${TMP_ROOT}`.quiet();
    await Bun.$`mkdir -p ${TMP_ROOT}`.quiet();
    await Bun.write(`${TMP_ROOT}/.env.development`, "TEST_AUTH_ENV_B=world\n");
    process.chdir(TMP_ROOT);
    process.env.NODE_ENV = "development";
    delete process.env.TEST_AUTH_ENV_B;

    loadRootEnv();

    expect(process.env.TEST_AUTH_ENV_B as string | undefined).toBe("world");
  });

  test("loads both root .env and app .env.<NODE_ENV>", async () => {
    await Bun.$`rm -rf ${TMP_ROOT}`.quiet();
    await Bun.$`mkdir -p ${TMP_ROOT}`.quiet();
    await Bun.write(`${TMP_ROOT}/.env`, "TEST_AUTH_ENV_A=root\n");
    await Bun.write(`${TMP_ROOT}/.env.development`, "TEST_AUTH_ENV_B=env\n");
    process.chdir(TMP_ROOT);
    process.env.NODE_ENV = "development";
    delete process.env.TEST_AUTH_ENV_A;
    delete process.env.TEST_AUTH_ENV_B;

    loadRootEnv();

    expect(process.env.TEST_AUTH_ENV_A as string | undefined).toBe("root");
    expect(process.env.TEST_AUTH_ENV_B as string | undefined).toBe("env");
  });

  test("does nothing when no env files exist", async () => {
    const emptyDir = "/tmp/opencode/env-load-empty-test";
    await Bun.$`rm -rf ${emptyDir}`.quiet();
    await Bun.$`mkdir -p ${emptyDir}`.quiet();
    process.chdir(emptyDir);
    process.env.NODE_ENV = "development";
    delete process.env.TEST_AUTH_ENV_A;
    delete process.env.TEST_AUTH_ENV_B;

    loadRootEnv();

    expect(process.env.TEST_AUTH_ENV_A).toBeUndefined();
    expect(process.env.TEST_AUTH_ENV_B).toBeUndefined();
  });
});
