const PR_NUMBER_PATTERNS = [
  /Merge pull request #(?<number>\d+)/iu,
  /\(#(?<number>\d+)\)/mu,
];

function extractPrNumber(commitMessage) {
  for (const pattern of PR_NUMBER_PATTERNS) {
    const match = commitMessage.match(pattern);
    if (match?.groups?.number) {
      return Number(match.groups.number);
    }
  }
  return null;
}

module.exports = async function detectPrMerge({ github, context, core }) {
  const { owner, repo } = context.repo;
  const commitSha = context.sha;
  let mergedPr = null;

  // 1. Prefer the PR number embedded in the merge commit message.
  const commitMessage = context.payload?.head_commit?.message ?? "";
  const prNumberFromMessage = extractPrNumber(commitMessage);
  if (prNumberFromMessage) {
    try {
      const prResponse = await github.rest.pulls.get({
        owner,
        pull_number: prNumberFromMessage,
        repo,
      });
      const pr = prResponse.data;
      // The message's PR number is only a hint: a later push could mention an
      // unrelated merged PR. Confirm this push is that PR's merge commit before
      // trusting it; otherwise fall through to the commit-scoped lookup below.
      if (
        pr?.merged_at &&
        pr.base.ref === "main" &&
        pr.merge_commit_sha === commitSha
      ) {
        mergedPr = pr;
      }
    } catch (error) {
      core.warning(
        `Could not fetch PR #${prNumberFromMessage} from commit message: ${error.message}`
      );
    }
  }

  // 2. Fall back to asking GitHub which PRs contain this commit.
  if (!mergedPr) {
    try {
      const response =
        await github.rest.repos.listPullRequestsAssociatedWithCommit({
          commit_sha: commitSha,
          owner,
          repo,
        });
      mergedPr = response.data.find(
        (pr) => pr.merged_at && pr.base.ref === "main"
      );
    } catch (error) {
      core.warning(
        `listPullRequestsAssociatedWithCommit failed: ${error.message}`
      );
    }
  }

  core.setOutput("should-build", "true");
  core.setOutput("pr-number", mergedPr ? String(mergedPr.number) : "");
  core.setOutput("quality-already-passed", "false");

  if (mergedPr) {
    core.info(`Detected merged PR #${mergedPr.number} for ${commitSha}`);
  } else {
    core.info(
      `Push on main without PR association for ${commitSha}; will build from push diff.`
    );
    return;
  }

  // A merged PR already gated on this exact check means quality does not need
  // to re-run on the merge commit.
  try {
    const headSha = mergedPr.head?.sha || mergedPr.merge_commit_sha;
    const checks = await github.rest.checks.listForRef({
      check_name: "Lint and Typecheck",
      filter: "latest",
      owner,
      per_page: 1,
      ref: headSha,
      repo,
    });

    const [qualityCheck] = checks.data.check_runs;
    const alreadyPassed = Boolean(
      qualityCheck && qualityCheck.conclusion === "success"
    );
    core.setOutput("quality-already-passed", alreadyPassed ? "true" : "false");
    core.info(
      alreadyPassed
        ? `PR #${mergedPr.number} "Lint and Typecheck" already passed (status ${qualityCheck.status}, conclusion ${qualityCheck.conclusion}); skipping quality on merge.`
        : `PR #${mergedPr.number} "Lint and Typecheck" did not pass (${qualityCheck?.conclusion ?? "no check run"}); quality will re-run.`
    );
  } catch (error) {
    core.warning(
      `Failed to check PR CI status: ${error.message}; quality will re-run.`
    );
  }
};
