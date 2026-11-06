import { expect, test } from "bun:test";
import path from "node:path";

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
}

interface Job {
  name?: string;
  needs?: string | string[];
  env?: Record<string, string>;
  services?: Record<string, { image: string; ports?: string[] }>;
  steps: Step[];
  strategy?: { "max-parallel": number; matrix: { shard: number[] } };
}

const root = path.resolve(import.meta.dir, "../..");
const workflow = Bun.YAML.parse(
  await Bun.file(path.join(root, ".github/workflows/ci.yml")).text()
) as { jobs: Record<string, Job> };
const { jobs } = workflow;

test("the existing required check waits for lint, both unit shards and integration tests", () => {
  expect(jobs.quality.name).toBe("Lint and Typecheck");
  expect(jobs.quality.needs).toEqual([
    "detect-pr-merge",
    "lint-types",
    "unit-tests",
    "integration-tests",
  ]);
});

test.each(["success", "failure", "cancelled", "skipped"])(
  "the quality gate handles an integration result of %s",
  async (result) => {
    const gate = jobs.quality.steps[0].run;
    if (!gate) {
      throw new Error("Quality gate command is missing");
    }
    const process = Bun.spawn(["bash", "-e", "-c", gate], {
      env: {
        ...Bun.env,
        INTEGRATION_RESULT: result,
        LINT_RESULT: "success",
        UNIT_RESULT: "success",
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(await process.exited).toBe(result === "success" ? 0 : 1);
  }
);

test("unit shards use the same immutable timings snapshot and separate timing outputs", () => {
  const unit = jobs["unit-tests"];
  expect(unit.strategy?.matrix.shard).toEqual([1, 2]);
  expect(unit.strategy?.["max-parallel"]).toBe(2);
  expect(unit.needs).toBe("lint-types");
  const snapshot = unit.steps.find((step) =>
    step.uses?.startsWith("actions/download-artifact@")
  );
  expect(snapshot?.with?.name).toBe("test-timings-baseline");
  expect(
    jobs["lint-types"].steps.some(
      (step) => step.with?.name === snapshot?.with?.name
    )
  ).toBe(true);
  const command = unit.steps.find(
    (step) => step.name === "Run unit test shard"
  )?.run;
  expect(command).toContain(
    `--unit --parallel=2 --shard=\${{ matrix.shard }}/2`
  );
  expect(command).toContain(
    `--timings=unit-test-timings-\${{ matrix.shard }}.json --timings=test-timings.json`
  );
  expect(jobs["save-test-timings"].needs).toBe("unit-tests");
});

test("integration tests have their own local database, migrations, Redis and serial runner", () => {
  const integration = jobs["integration-tests"];
  expect(integration.env?.DATABASE_URL).toBe(
    "postgresql://postgres:postgres@localhost:5433/asocialmedia"
  );
  expect(integration.services?.postgres.ports).toEqual(["5433:5432"]);
  expect(integration.services?.redis.image).toBe("redis:7-alpine");
  expect(
    integration.steps.some((step) => step.run?.includes("prisma db migrate"))
  ).toBe(true);
  const command = integration.steps.at(-1)?.run;
  expect(command).toContain("--integration --parallel=1");
  expect(command).not.toContain("--unit");
});

test("ordinary type checks are capped rather than spawning every workspace at once", async () => {
  const manifest = await Bun.file(path.join(root, "package.json")).json();
  expect(manifest.scripts["check-types"]).toContain(
    "turbo check-types --concurrency=2"
  );
});
