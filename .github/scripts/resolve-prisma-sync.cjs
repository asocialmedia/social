const { selectChangedFiles } = require("./select-changed-files.cjs");

const PRISMA_PATHS = new Set([
  "packages/db/prisma/contract.prisma",
  "packages/db/prisma.config.ts",
  "packages/db/keys.ts",
  "docker/prisma-package.json",
  "docker/prisma-sync.dockerfile",
  "docker/prisma-sync.sh",
  "scripts/sync-trending-scores.ts",
]);

const PRISMA_PREFIXES = ["packages/db/"];
const TRIGGER_FILES = new Set([
  "bun.lock",
  "package.json",
  "turbo.json",
  "tsconfig.json",
]);

module.exports = async function resolvePrismaSync({
  github,
  context,
  core,
  prNumber,
}) {
  const { owner, repo } = context.repo;
  const { files: changedFiles, truncated } = await selectChangedFiles({
    context,
    github,
    owner,
    prNumber,
    repo,
  });

  const relevant = changedFiles.filter(
    (file) =>
      PRISMA_PATHS.has(file) ||
      PRISMA_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
      TRIGGER_FILES.has(file)
  );

  // A capped file list could have hidden a schema change, so treat truncation as
  // "needs syncing" rather than skipping it.
  const shouldRun = truncated || relevant.length > 0;
  if (truncated) {
    core.warning(
      `Changed-file list was truncated at ${changedFiles.length}; running Prisma sync.`
    );
  }

  core.setOutput("should-run", shouldRun ? "true" : "false");
  core.setOutput("needed-files", relevant.join(", "));
  core.info(
    `Prisma sync ${shouldRun ? "needed" : "skipped"}. Changed files: ${changedFiles.join(", ")}`
  );
};
