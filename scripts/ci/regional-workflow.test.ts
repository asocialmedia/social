import { expect, test } from "bun:test";
import path from "node:path";
import { runInNewContext } from "node:vm";

interface Workflow {
  jobs: Record<
    string,
    {
      "runs-on": string;
      steps: {
        name: string;
        if?: string;
        uses?: string;
        with?: Record<string, unknown>;
      }[];
    }
  >;
}

test("web and Android use four-core runners while other jobs keep base runners and storage", async () => {
  for (const filename of [
    "ci.yml",
    "deploy-protocols.yml",
    "rustfs-buckets.yml",
  ]) {
    const workflow = Bun.YAML.parse(
      await Bun.file(
        path.resolve(import.meta.dir, "../../.github/workflows", filename)
      ).text()
    ) as Workflow;
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (filename === "ci.yml" && name === "build-and-push") {
        const expression = job["runs-on"].replace(/^\$\{\{|\}\}$/g, "").trim();
        for (const app of ["web", "auth", "protocols", "media-processing"]) {
          expect(runInNewContext(expression, { matrix: { app } })).toBe(
            app === "web"
              ? "blacksmith-4vcpu-ubuntu-2404"
              : "blacksmith-2vcpu-ubuntu-2404"
          );
        }
      } else {
        expect(job["runs-on"]).toBe(
          filename === "ci.yml" && name === "build-mobile-apk"
            ? "blacksmith-4vcpu-ubuntu-2404"
            : "blacksmith-2vcpu-ubuntu-2404"
        );
      }
      for (const step of job.steps) {
        expect(step.uses ?? "").not.toMatch(/^useblacksmith\//);
        if (step.uses?.startsWith("docker/build-push-action@")) {
          expect(step.with?.["cache-from"]).toStartWith("type=gha,scope=");
          expect(step.with?.["cache-to"]).toStartWith(
            "type=gha,mode=max,scope="
          );
        }
      }
    }
  }
});

test("US East deployment still runs after primary failure, only for a published protocols image", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(
      path.resolve(import.meta.dir, "../../.github/workflows/ci.yml")
    ).text()
  ) as Workflow;
  const step = workflow.jobs["build-and-push"]?.steps.find(
    (entry) => entry.name === "Deploy US East protocols"
  );
  expect(step?.if).toBeDefined();
  const condition = step?.if?.replace(/^\$\{\{|\}\}$/g, "").trim() ?? "false";
  for (const primarySucceeded of [true, false]) {
    for (const app of ["protocols", "web"]) {
      for (const outcome of ["success", "failure", "skipped"]) {
        const shouldRun = runInNewContext(condition, {
          always: () => true,
          matrix: { app },
          steps: { build_image: { outcome } },
          success: () => primarySucceeded,
        });
        expect(shouldRun).toBe(app === "protocols" && outcome === "success");
      }
    }
  }
});
