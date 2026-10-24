import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dir, "../..");
const fakeToken = "dokploy-test-token";
const previousDeployment = [{ deploymentId: "previous", status: "done" }];

interface ResponseFixture {
  body: unknown;
  status: number;
  transportStatus?: number;
}

async function runDeployment(
  responses: ResponseFixture[],
  options: {
    checkOnly?: boolean;
    env?: Record<string, string>;
    script?: string;
  } = {}
) {
  const directory = await mkdtemp(path.join(tmpdir(), "asm-dokploy-ci-"));
  try {
    const queue = path.join(directory, "responses.json");
    const requests = path.join(directory, "requests.jsonl");
    await writeFile(queue, JSON.stringify(responses));
    await writeFile(requests, "");
    await writeFile(
      path.join(directory, "curl"),
      `#!/usr/bin/env bun
const args = process.argv.slice(2);
const queue = process.env.DOKPLOY_TEST_QUEUE;
const responses = await Bun.file(queue).json();
const response = responses.shift();
if (!response) process.exit(99);
await Bun.write(queue, JSON.stringify(responses));
const requests = process.env.DOKPLOY_TEST_REQUESTS;
await Bun.write(requests, await Bun.file(requests).text() + JSON.stringify(args) + "\\n");
const output = args[args.indexOf("--output") + 1];
await Bun.write(output, JSON.stringify(response.body));
process.stdout.write(String(response.status));
process.exit(response.transportStatus ?? 0);
`,
      { mode: 0o755 }
    );
    await writeFile(path.join(directory, "sleep"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    const child = Bun.spawn(
      [
        "bash",
        options.script ?? "scripts/ci/prisma-sync-deploy.sh",
        ...(options.checkOnly ? ["--check"] : []),
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          DOKPLOY_API_TOKEN: fakeToken,
          DOKPLOY_API_URL: "https://dokploy.example.test/api/",
          DOKPLOY_APP_ID: "web-app",
          DOKPLOY_PRISMA_APP_ID: "prisma-app",
          DOKPLOY_TEST_QUEUE: queue,
          DOKPLOY_TEST_REQUESTS: requests,
          PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
          ...options.env,
        },
        stderr: "pipe",
        stdout: "pipe",
      }
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const calls: string[][] = (await readFile(requests, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line: string) => JSON.parse(line));
    return { calls, exitCode, stderr, stdout };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

describe("Dokploy deployment authentication", () => {
  test.each([401, 403])(
    "rejects HTTP %s before triggering Prisma sync",
    async (status) => {
      const result = await runDeployment([
        { body: { message: "Unauthorized", token: fakeToken }, status },
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(`HTTP ${status}`);
      expect(result.stderr).toContain("DOKPLOY_API_TOKEN");
      expect(result.stderr).not.toContain("did not return a JSON array");
      expect(result.stderr + result.stdout).not.toContain(fakeToken);
      expect(result.calls).toHaveLength(1);
    }
  );

  test("read-only preflight verifies the application without deploying it", async () => {
    const result = await runDeployment(
      [{ body: previousDeployment, status: 200 }],
      { checkOnly: true }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("no deployment triggered");
    expect(result.calls).toHaveLength(1);
    const [request] = result.calls;
    expect(request).toContain(
      "https://dokploy.example.test/api/deployment.all?applicationId=prisma-app"
    );
    expect(request).toContain(`x-api-key: ${fakeToken}`);
    expect(request).toContain("--proto");
    expect(request).toContain("=https");
    expect(request).not.toContain("-L");
    expect(request).not.toContain("POST");
  });

  test("read-only preflight accepts an application with no prior deployments", async () => {
    const result = await runDeployment([{ body: [], status: 200 }], {
      checkOnly: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.calls).toHaveLength(1);
  });

  test("preflight still rejects malformed deployment records", async () => {
    const result = await runDeployment(
      [{ body: [{ status: "done" }], status: 200 }],
      { checkOnly: true }
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("without a usable deploymentId");
    expect(result.calls).toHaveLength(1);
  });

  test.each([302, 503])(
    "rejects HTTP %s without treating its body as deployment data",
    async (status) => {
      const result = await runDeployment([
        { body: previousDeployment, status },
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(`HTTP ${status}`);
      expect(result.calls).toHaveLength(1);
    }
  );

  test("rejects transport failures even if curl produces a body", async () => {
    const result = await runDeployment([
      { body: previousDeployment, status: 0, transportStatus: 7 },
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("curl exit 7");
    expect(result.calls).toHaveLength(1);
  });

  test("does not accept a previous successful deployment as the new sync", async () => {
    const result = await runDeployment([
      { body: previousDeployment, status: 200 },
      { body: {}, status: 200 },
      { body: previousDeployment, status: 200 },
      { body: [{ deploymentId: "new-sync", status: "done" }], status: 200 },
      { body: "PRISMA_SYNC_OK", status: 200 },
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("still on previous deployment");
    expect(result.stdout).toContain(
      "deployment new-sync completed successfully"
    );
    expect(
      result.calls.filter((request) => request.includes("POST"))
    ).toHaveLength(1);
  });

  test("stops polling immediately when authentication is revoked", async () => {
    const result = await runDeployment([
      { body: previousDeployment, status: 200 },
      { body: {}, status: 200 },
      { body: { message: "Unauthorized" }, status: 401 },
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("HTTP 401");
    expect(result.calls).toHaveLength(3);
  });

  test("recovers from a transient polling failure while waiting for the new deployment", async () => {
    const result = await runDeployment([
      { body: previousDeployment, status: 200 },
      { body: {}, status: 200 },
      { body: {}, status: 503 },
      { body: [{ deploymentId: "new-sync", status: "done" }], status: 200 },
      { body: "PRISMA_SYNC_OK", status: 200 },
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "deployment new-sync completed successfully"
    );
  });

  test("application deploys report authentication failure instead of success", async () => {
    const result = await runDeployment([{ body: {}, status: 401 }], {
      script: "scripts/ci/dokploy-deploy.sh",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("HTTP 401");
    expect(result.stdout).not.toContain("deploy triggered");
  });

  const protocolsApplication = {
    applicationId: "us-east-protocols",
    dockerImage: "ghcr.io/asocialmedia/asm-protocols:latest",
    sourceType: "docker",
  };

  test("classifier deployment verifies the worker image before redeploying", async () => {
    const result = await runDeployment(
      [
        {
          body: {
            applicationId: "classifier-app",
            dockerImage: "ghcr.io/asocialmedia/asm-classifier:latest",
            sourceType: "docker",
          },
          status: 200,
        },
        { body: {}, status: 200 },
      ],
      {
        env: { DOKPLOY_APP_ID: "classifier-app" },
        script: "scripts/ci/deploy-classifier.sh",
      }
    );
    expect(result.exitCode).toBe(0);
    expect(result.calls).toHaveLength(2);
    expect(result.calls[0]).toContain("applicationId=classifier-app");
    expect(result.calls[1]).toContain(
      JSON.stringify({ applicationId: "classifier-app" })
    );
  });

  test("classifier deployment rejects a different app's image without deploying", async () => {
    const result = await runDeployment(
      [
        {
          body: { ...protocolsApplication, applicationId: "classifier-app" },
          status: 200,
        },
      ],
      {
        env: { DOKPLOY_APP_ID: "classifier-app" },
        script: "scripts/ci/deploy-classifier.sh",
      }
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.calls).toHaveLength(1);
  });
  const regionalOptions = {
    env: {
      DOKPLOY_API_TOKEN: "us-east-token",
      DOKPLOY_API_URL: "https://us-east.example.test/api",
      DOKPLOY_APP_ID: protocolsApplication.applicationId,
    },
    script: "scripts/ci/deploy-protocols-region.sh",
  };

  test("regional protocols deploys use only that region's credentials and application", async () => {
    const result = await runDeployment(
      [
        { body: protocolsApplication, status: 200 },
        { body: {}, status: 200 },
      ],
      regionalOptions
    );
    expect(result.exitCode).toBe(0);
    expect(result.calls).toHaveLength(2);
    for (const request of result.calls) {
      expect(request).toContain("x-api-key: us-east-token");
      expect(request).not.toContain(`x-api-key: ${fakeToken}`);
      expect(
        request.some((value) =>
          value.startsWith("https://us-east.example.test/api/")
        )
      ).toBe(true);
    }
    expect(result.calls[0]).toContain("applicationId=us-east-protocols");
    expect(result.calls[1]).toContain(
      JSON.stringify({ applicationId: "us-east-protocols" })
    );
    expect(result.stdout).not.toContain("us-east-token");
  });

  test("regional preflight verifies the target without posting a deployment", async () => {
    const result = await runDeployment(
      [{ body: protocolsApplication, status: 200 }],
      { ...regionalOptions, checkOnly: true }
    );
    expect(result.exitCode).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).not.toContain("POST");
  });

  for (const variable of [
    "DOKPLOY_API_URL",
    "DOKPLOY_API_TOKEN",
    "DOKPLOY_APP_ID",
  ]) {
    test(`regional deploy refuses missing ${variable} instead of silently skipping`, async () => {
      const result = await runDeployment([], {
        ...regionalOptions,
        env: { ...regionalOptions.env, [variable]: "" },
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.calls).toHaveLength(0);
      expect(result.stderr).toContain(variable);
    });
  }

  for (const invalid of [
    { applicationId: "other-app" },
    { sourceType: "github" },
    { dockerImage: "ghcr.io/asocialmedia/asm-auth:latest" },
  ]) {
    test(`regional deploy refuses an unexpected target ${JSON.stringify(invalid)}`, async () => {
      const result = await runDeployment(
        [{ body: { ...protocolsApplication, ...invalid }, status: 200 }],
        regionalOptions
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0]).not.toContain("POST");
    });
  }

  test("regional deploy does not post after failed authentication", async () => {
    const result = await runDeployment(
      [{ body: {}, status: 401 }],
      regionalOptions
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.stderr).toContain("HTTP 401");
  });

  test("release workflows authenticate before building Prisma images", async () => {
    const workflow = await Bun.file(
      path.join(repositoryRoot, ".github/workflows/ci.yml")
    ).text();
    const prismaJob =
      workflow
        .split("\n  prisma-sync:")[1]
        ?.split("\n  build-mobile-apk:")[0] ?? "";
    const preflight = prismaJob.indexOf(
      "run: bash scripts/ci/prisma-sync-deploy.sh --check"
    );
    expect(preflight).toBeGreaterThan(-1);
    expect(prismaJob.indexOf("- name: Set up QEMU")).toBeGreaterThan(preflight);
    expect(
      prismaJob.indexOf("- name: Build and push Prisma sync image")
    ).toBeGreaterThan(preflight);
    const manualJob =
      workflow
        .split("\n  dokploy-preflight:")[1]
        ?.split("\n  prisma-sync:")[0] ?? "";
    expect(manualJob).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(manualJob).toContain(
      "run: bash scripts/ci/prisma-sync-deploy.sh --check"
    );
  });
});
