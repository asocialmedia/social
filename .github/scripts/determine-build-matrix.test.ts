import { expect, test } from "bun:test";

import determineBuildMatrix from "./determine-build-matrix.cjs";

interface FileChange {
  filename: string;
  changes?: number;
  patch?: string;
  status?: string;
}

async function select(files: (string | FileChange)[], source = "pr") {
  const changes = files.map((file) =>
    typeof file === "string" ? { filename: file } : file
  );
  const outputs: Record<string, string> = {};
  await determineBuildMatrix({
    context: {
      payload: source === "push" ? { after: "after", before: "before" } : {},
      repo: { owner: "asocialmedia", repo: "social" },
      sha: "after",
    },
    core: {
      info: () => {},
      setOutput: (name: string, value: string) => {
        outputs[name] = value;
      },
      warning: () => {},
    },
    github: {
      paginate: () => changes,
      rest: {
        pulls: { listFiles: () => ({ data: [] }) },
        repos: {
          compareCommitsWithBasehead: () => ({ data: { files: changes } }),
          getCommit: () => ({ data: { files: changes } }),
        },
      },
    },
    prNumber: source === "pr" ? 7 : undefined,
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

const rootVersion: FileChange = {
  changes: 2,
  filename: "package.json",
  patch:
    '@@ -1,5 +1,5 @@\n {\n   "name": "@asocialmedia/social",\n-  "version": "1.12.75",\n+  "version": "1.12.80",\n   "private": true,',
  status: "modified",
};
const workspaceVersions: FileChange = {
  changes: 4,
  filename: "bun.lock",
  patch:
    '@@ -180,5 +180,5 @@\n     "apps/protocols": {\n       "name": "@asm/protocols-app",\n-      "version": "0.1.58",\n+      "version": "0.1.63",\n       "dependencies": {\n@@ -449,5 +449,5 @@\n     "packages/protocols": {\n       "name": "@asm/protocols",\n-      "version": "0.1.58",\n+      "version": "0.1.63",\n       "dependencies": {',
  status: "modified",
};

test.each(["pr", "push", "initial"])(
  "release metadata in a %s skips Android without suppressing service images",
  async (source) => {
    const outputs = await select(
      [
        "apps/protocols/src/discovery.ts",
        "packages/protocols/src/bluesky/client.ts",
        rootVersion,
        workspaceVersions,
      ],
      source
    );
    expect(outputs["has-mobile-changes"]).toBe("false");
    expect(outputs["selected-apps"]?.split(",")).toEqual([
      "web",
      "auth",
      "media-processing",
      "protocols",
    ]);
  }
);

test.each([
  "apps/mobile/src/app/index.tsx",
  "apps/mobile/app.config.ts",
  "apps/mobile/package.json",
  "apps/mobile/scripts/build-android-apk.ts",
])(
  "mobile input %s still builds Android alongside version-only stamps",
  async (file) => {
    const outputs = await select([file, rootVersion, workspaceVersions]);
    expect(outputs["has-mobile-changes"]).toBe("true");
  }
);

test.each(["package.json", "bun.lock"])(
  "real dependencies in %s still build Android",
  async (filename) => {
    const file: FileChange = {
      changes: 2,
      filename,
      patch:
        '@@ -10,2 +10,2 @@\n-    "react-native": "0.87.0",\n+    "react-native": "0.88.0",',
      status: "modified",
    };
    const outputs = await select([
      file,
      rootVersion.filename === filename ? workspaceVersions : rootVersion,
    ]);
    expect(outputs["has-mobile-changes"]).toBe("true");
  }
);

test.each([
  { ...rootVersion, patch: undefined },
  { ...rootVersion, changes: 4 },
  { ...rootVersion, status: "added" },
  { ...rootVersion, changes: undefined },
  {
    ...workspaceVersions,
    changes: 2,
    patch:
      '@@ -10,2 +10,2 @@\n-      "version": "1.0.0",\n+      "version": "1.0.1",',
  },
])("unverifiable metadata retains the Android build (%j)", async (change) => {
  const outputs = await select([change]);
  expect(outputs["has-mobile-changes"]).toBe("true");
});

test("a capped push file list retains the Android build", async () => {
  const files = Array.from({ length: 298 }, (_, i) => `docs/${i}.md`);
  const outputs = await select(
    [...files, rootVersion, workspaceVersions],
    "push"
  );
  expect(outputs["has-mobile-changes"]).toBe("true");
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

test("classifier code publishes its standalone context without other service images", async () => {
  const outputs = await select([
    "apps/classifier/src/inference.ts",
    rootVersion,
    workspaceVersions,
  ]);
  const matrix = JSON.parse(outputs.matrix ?? "{}");
  expect(matrix.include).toContainEqual({
    app: "classifier",
    context: "./apps/classifier",
    dockerfile: "./apps/classifier/Dockerfile",
    image: "asm-classifier",
  });
  expect(outputs["selected-apps"]).toBe("classifier");
  const isolated = await select(["apps/classifier/src/inference.ts"]);
  expect(isolated["selected-apps"]).toBe("classifier");
  expect(isolated["has-mobile-changes"]).toBe("false");
});

test.each([
  "apps/classifier/README.md",
  "apps/classifier/src/inference.test.ts",
  "apps/classifier/scripts/benchmark.ts",
  "apps/classifier/.env.development",
  "packages/protocols/src/contracts.ts",
  "bun.lock",
])(
  "unrelated input %s does not rebuild the isolated classifier",
  async (file) => {
    const outputs = await select([file]);
    expect(outputs["selected-apps"]?.split(",")).not.toContain("classifier");
  }
);

test("classifier release-only version stamps do not publish another image", async () => {
  const outputs = await select([
    { ...rootVersion, filename: "apps/classifier/package.json" },
    rootVersion,
    workspaceVersions,
  ]);
  expect(outputs["selected-apps"]?.split(",")).not.toContain("classifier");
});
