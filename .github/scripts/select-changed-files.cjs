const ZERO_SHA = "0000000000000000000000000000000000000000";

async function selectChangedFiles({ github, context, owner, repo, prNumber }) {
  if (prNumber) {
    const files = await github.paginate(github.rest.pulls.listFiles, {
      owner,
      per_page: 100,
      pull_number: prNumber,
      repo,
    });
    return files.map((file) => file.filename);
  }

  const { before, after } = context.payload;
  if (before && after && before !== ZERO_SHA) {
    const comparison = await github.rest.repos.compareCommitsWithBasehead({
      basehead: `${before}...${after}`,
      owner,
      repo,
    });
    return (comparison.data.files || []).map((file) => file.filename);
  }

  const commit = await github.rest.repos.getCommit({
    owner,
    ref: context.sha,
    repo,
  });
  return (commit.data.files || []).map((file) => file.filename);
}

module.exports = { selectChangedFiles };
