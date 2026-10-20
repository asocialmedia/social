import { expect, test } from "bun:test";

import determineBuildMatrix from "./determine-build-matrix.cjs";

async function select(files: string[]) {
  const outputs: Record<string, string> = {};
  await determineBuildMatrix({
    context: { repo: { owner: "asocialmedia", repo: "social" } },
    core: {
      info: () => {},
      setOutput: (name: string, value: string) => {
        outputs[name] = value;
      },
      warning: () => {},
    },
    github: {
      paginate: () => files.map((filename) => ({ filename })),
      rest: { pulls: { listFiles: () => ({ data: [] }) } },
    },
    prNumber: 7,
  });
  return outputs;
}

test("a protocols app change selects its publishable image without a mobile build", async () => {
  const outputs = await select(["apps/protocols/src/index.ts"]);
  expect(JSON.parse(outputs.matrix ?? "{}")).toEqual({
    include: [
      {
        app: "protocols",
        dockerfile: "./apps/protocols/Dockerfile",
        image: "asm-protocols",
      },
    ],
  });
  expect(outputs["selected-apps"]).toBe("protocols");
  expect(outputs["has-mobile-changes"]).toBe("false");
});

test("shared protocol changes rebuild all service images", async () => {
  const outputs = await select(["packages/protocols/src/contracts.ts"]);
  expect(outputs["selected-apps"]?.split(",")).toEqual([
    "web",
    "auth",
    "media-processing",
    "protocols",
  ]);
});

test("unrelated docs do not publish service images", async () => {
  const outputs = await select([".github/AI_POLICY.md"]);
  expect(outputs["has-app-changes"]).toBe("false");
  expect(outputs["selected-apps"]).toBe("");
});
