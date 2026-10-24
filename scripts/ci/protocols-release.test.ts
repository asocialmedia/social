import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dir, "../..");

async function runMetadataScript(script: string, env: Record<string, string>) {
  const directory = await mkdtemp(path.join(tmpdir(), "asm-protocols-ci-"));
  const output = path.join(directory, "outputs");
  try {
    const child = Bun.spawn(["bash", script, "protocols"], {
      cwd: repositoryRoot,
      env: { ...process.env, ...env, GITHUB_OUTPUT: output },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(await child.exited).toBe(0);
    return Object.fromEntries(
      (await readFile(output, "utf8"))
        .trim()
        .split("\n")
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        })
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test("protocols image tags follow the app manifest version", async () => {
  const manifest: { version: string } = await Bun.file(
    path.join(repositoryRoot, "apps/protocols/package.json")
  ).json();
  const outputs = await runMetadataScript("scripts/ci/app-version.sh", {});
  expect(outputs.app_version).toBe(manifest.version);
  expect(outputs.tag_name).toBe(`protocols-v${manifest.version}`);
});

test("configured protocols deployments use their own Dokploy target", async () => {
  const outputs = await runMetadataScript(
    "scripts/ci/resolve-deploy-targets.sh",
    {
      DOKPLOY_API_TOKEN: "test-token",
      DOKPLOY_API_URL: "https://dokploy.example.test",
      DOKPLOY_AUTH_APP_ID: "auth-app",
      DOKPLOY_PROTOCOLS_APP_ID: "protocols-app",
      PROTOCOLS_HEALTH_URL: "https://protocols.example.test/health",
    }
  );
  expect(outputs.app_id).toBe("protocols-app");
  expect(outputs.deploy_enabled).toBe("true");
  expect(outputs.health_url).toBe("https://protocols.example.test/health");
});

test("image publishing does not require a configured protocols deployment", async () => {
  const outputs = await runMetadataScript(
    "scripts/ci/resolve-deploy-targets.sh",
    {
      DOKPLOY_API_TOKEN: "",
      DOKPLOY_API_URL: "",
      DOKPLOY_PROTOCOLS_APP_ID: "",
      PROTOCOLS_HEALTH_URL: "",
    }
  );
  expect(outputs.deploy_enabled).toBe("false");
  expect(outputs.health_enabled).toBe("false");
});
