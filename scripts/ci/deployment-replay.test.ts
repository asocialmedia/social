import { expect, mock, test } from "bun:test";
import { createRequire } from "node:module";

const detectPrMerge: (options: object) => Promise<void> = createRequire(
  import.meta.url
)("../../.github/scripts/detect-pr-merge.cjs");

function replayFixture(comparisonStatus = "ahead", targetBranch = "main") {
  const setOutput = mock();
  const get = mock(() =>
    Promise.resolve({
      data: {
        base: { ref: targetBranch },
        merge_commit_sha: "merged-commit",
        merged_at: "2026-11-23",
      },
    })
  );
  const compare = mock(() =>
    Promise.resolve({ data: { status: comparisonStatus } })
  );
  return {
    compare,
    get,
    run: (replayPr: string) =>
      detectPrMerge({
        context: {
          repo: { owner: "asocialmedia", repo: "social" },
          sha: "current-main",
        },
        core: { info: mock(), setOutput, warning: mock() },
        github: {
          rest: {
            pulls: { get },
            repos: { compareCommitsWithBasehead: compare },
          },
        },
        replayPr,
      }),
    setOutput,
  };
}

test("a replay verifies the merged PR and builds the current main commit", async () => {
  const { run, get, compare, setOutput } = replayFixture();
  await run("220");
  expect(get).toHaveBeenCalledWith({
    owner: "asocialmedia",
    pull_number: 220,
    repo: "social",
  });
  expect(compare).toHaveBeenCalledWith({
    basehead: "merged-commit...current-main",
    owner: "asocialmedia",
    repo: "social",
  });
  expect(setOutput.mock.calls).toEqual([
    ["should-build", "true"],
    ["pr-number", "220"],
    ["quality-already-passed", "false"],
  ]);
});

test("a replay fails closed for invalid input, other branches, and unrelated commits", async () => {
  const invalid = replayFixture();
  await expect(invalid.run("220;echo")).rejects.toThrow(
    "positive pull request number"
  );
  expect(invalid.get).not.toHaveBeenCalled();
  const otherBranch = replayFixture("ahead", "dev");
  await expect(otherBranch.run("220")).rejects.toThrow(
    "was not merged into main"
  );
  expect(otherBranch.compare).not.toHaveBeenCalled();
  const unrelated = replayFixture("diverged");
  await expect(unrelated.run("220")).rejects.toThrow(
    "not in the current main history"
  );
  expect(unrelated.setOutput).not.toHaveBeenCalled();
});
