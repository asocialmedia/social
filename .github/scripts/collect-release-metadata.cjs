function commitFromApi(commit) {
  return {
    author: commit.author?.login || commit.commit.author?.name || "unknown",
    authorUrl: commit.author?.html_url || "",
    message: commit.commit.message,
    sha: commit.sha,
  };
}

module.exports = async function collectReleaseMetadata({
  github,
  context,
  core,
  prNumber,
}) {
  const { owner, repo } = context.repo;
  let commits = [];
  let authors = [];
  let prTitle = "";
  let prUrl = "";

  if (prNumber) {
    try {
      const prResponse = await github.rest.pulls.get({
        owner,
        pull_number: prNumber,
        repo,
      });
      prTitle = prResponse.data?.title ?? "";
      prUrl = prResponse.data?.html_url ?? "";

      const prCommits = await github.paginate(github.rest.pulls.listCommits, {
        owner,
        per_page: 100,
        pull_number: prNumber,
        repo,
      });
      commits = prCommits.map(commitFromApi);
      authors = [
        ...new Set(
          commits
            .map((commit) => commit.author)
            .filter((author) => author !== "unknown")
        ),
      ];
    } catch (error) {
      core.warning(`Failed to fetch PR commits: ${error.message}`);
    }
  }

  // A direct push has no PR to read, so fall back to the pushed head commit.
  if (commits.length === 0) {
    const headCommit = context.payload?.head_commit;
    if (headCommit) {
      const author =
        headCommit.author?.username || headCommit.author?.name || context.actor;
      commits.push({
        author,
        message: headCommit.message,
        sha: headCommit.id,
      });
      authors = [author];
    }
  }

  core.setOutput("commits_json", JSON.stringify(commits));
  core.setOutput("authors_json", JSON.stringify(authors));
  core.setOutput("pr_title", prTitle);
  core.setOutput("pr_url", prUrl);
};
