import { expect, test } from "bun:test";

interface WorkflowStep {
  name: string;
  env?: Record<string, string>;
  run?: string;
  with?: Record<string, string | boolean>;
}

interface Workflow {
  jobs: Record<
    string,
    {
      needs: string[];
      strategy?: {
        "fail-fast": boolean;
        matrix: { include: { abi: string; "build-mode": string }[] };
      };
      steps: WorkflowStep[];
    }
  >;
}

const workflow = Bun.YAML.parse(
  await Bun.file(
    new URL("../../.github/workflows/ci.yml", import.meta.url)
  ).text()
) as Workflow;

test("release builds sign phone and emulator APKs and build the AAB only once", () => {
  const job = workflow.jobs["build-mobile-apk"];
  expect(job?.strategy?.matrix.include).toEqual([
    { abi: "arm64-v8a", "build-mode": "--all" },
    { abi: "x86_64", "build-mode": "" },
  ]);
  expect(job?.strategy?.["fail-fast"]).toBe(false);
  const build = job?.steps.find(
    (step) => step.name === "Build signed release APK"
  );
  expect(build?.env?.ASM_ANDROID_ABI).toBe("${{ matrix.abi }}");
  expect(build?.env?.ANDROID_KEYSTORE_BASE64).toBe(
    "${{ secrets.ANDROID_KEYSTORE_BASE64 }}"
  );
  expect(build?.run).toBe(
    "bun apps/mobile/scripts/android/build-android-apk.ts ${{ matrix.build-mode }}"
  );
});

test("release publishing combines distinct artifacts from both ABI builds", () => {
  const upload = workflow.jobs["build-mobile-apk"]?.steps.find(
    (step) => step.name === "Upload mobile artifacts"
  );
  expect(upload?.with?.name).toBe("mobile-apk-${{ matrix.abi }}");
  const release = workflow.jobs["create-release"];
  expect(release?.needs).toContain("build-mobile-apk");
  const download = release?.steps.find(
    (step) => step.name === "Download mobile APK artifact"
  );
  expect(download?.with?.pattern).toBe("mobile-apk-*");
  expect(download?.with?.["merge-multiple"]).toBe(true);
  expect(download?.with?.path).toBe("build-artifacts");
});
