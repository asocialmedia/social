// Resolves the changed file paths for a push to main.
//
// Returns { files, truncated }. `truncated` is true when the API capped the
// file list, meaning `files` is incomplete and callers must fail closed (build
// everything) rather than risk omitting a change that should have triggered a
// build.
//
// Loaded by actions/github-script via require(), so this stays CommonJS (the
// repository is `type: module`, hence the .cjs extension).

const ZERO_SHA = "0000000000000000000000000000000000000000";

// The compare and commit endpoints return at most 300 files and expose no
// "more files" flag, so a full list is indistinguishable from a capped one.
// Treating the cap as truncated over-builds in a rare case instead of silently
// skipping a needed build.
const FILE_LIST_CAP = 300;

async function selectChangedFiles({ github, context, owner, repo, prNumber }) {
  // Paginated, so never truncated.
  if (prNumber) {
    const files = await github.paginate(github.rest.pulls.listFiles, {
      owner,
      per_page: 100,
      pull_number: prNumber,
      repo,
    });
    return { files: files.map((file) => file.filename), truncated: false };
  }

  const { before, after } = context.payload;
  if (before && after && before !== ZERO_SHA) {
    const comparison = await github.rest.repos.compareCommitsWithBasehead({
      basehead: `${before}...${after}`,
      owner,
      repo,
    });
    const files = comparison.data.files || [];
    return {
      files: files.map((file) => file.filename),
      truncated: files.length >= FILE_LIST_CAP,
    };
  }

  const commit = await github.rest.repos.getCommit({
    owner,
    ref: context.sha,
    repo,
  });
  const files = commit.data.files || [];
  return {
    files: files.map((file) => file.filename),
    truncated: files.length >= FILE_LIST_CAP,
  };
}

module.exports = { selectChangedFiles };
