import { readTestWorkspaces, selectAffectedTests } from "./affected-tests";
import { runTestSuite } from "./run-tests";
import { collectTestFiles } from "./test-file-discovery";
import { versionOnlyPushedMetadata } from "./version-only-metadata";

export async function runAffectedTests(arguments_ = Bun.argv.slice(2)) {
  const changedFiles = arguments_.filter(
    (argument) => argument !== "--pre-push"
  );
  const pushInput = arguments_.includes("--pre-push")
    ? await Bun.stdin.text()
    : undefined;
  if (changedFiles.length === 0) {
    console.log("No pushed files supplied; no local tests to run.");
    return 0;
  }
  const [testFiles, workspaces, versionOnlyFiles] = await Promise.all([
    collectTestFiles("unit"),
    readTestWorkspaces(),
    versionOnlyPushedMetadata(changedFiles, pushInput),
  ]);
  const selected = selectAffectedTests(
    changedFiles.filter((filePath) => !versionOnlyFiles.includes(filePath)),
    testFiles,
    workspaces
  );
  console.log(
    `Local push: ${selected.length}/${testFiles.length} unit test files, at most 2 workers. The full suite command runs in CI.`
  );
  if (selected.length === 0) {
    return 0;
  }
  return await runTestSuite(["--unit", "--parallel=2"], {
    collectFiles: () => Promise.resolve(selected),
    recordTimings: false,
  });
}

if (import.meta.main) {
  try {
    process.exit(await runAffectedTests());
  } catch (error) {
    console.error("Failed to run affected tests:", error);
    process.exit(1);
  }
}
