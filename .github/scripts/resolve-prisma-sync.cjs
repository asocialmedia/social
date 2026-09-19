const { selectChangedFiles } = require("./select-changed-files.cjs");

const PRISMA_PATHS = new Set([
  "packages/db/prisma/schema.prisma",
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
  const changedFiles = await selectChangedFiles({
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

  core.setOutput("should-run", relevant.length > 0 ? "true" : "false");
  core.setOutput("needed-files", relevant.join(", "));
  core.info(
    `Prisma sync ${relevant.length > 0 ? "needed" : "skipped"}. Changed files: ${changedFiles.join(", ")}`
  );
};
