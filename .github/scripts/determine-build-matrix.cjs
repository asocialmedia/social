const APP_ENTRIES = [
  { app: "web", dockerfile: "./apps/web/Dockerfile", image: "asm-web" },
  { app: "auth", dockerfile: "./apps/auth/Dockerfile", image: "asm-auth" },
  {
    app: "media-processing",
    dockerfile: "./apps/media-processing/Dockerfile",
    image: "asm-media-processing",
  },
];

// Shared code or build config invalidates every image.
const TRIGGER_ALL_PREFIXES = ["packages/", "docker/"];
const TRIGGER_ALL_FILES = new Set([
  "bun.lock",
  "package.json",
  "turbo.json",
  "tsconfig.json",
]);

// The mobile build only cares about the mobile workspace plus the root
// manifests that can change dependency resolution. Changes under packages/
// stay excluded from mobile-build detection.
const MOBILE_TRIGGER_FILES = new Set(["package.json", "bun.lock"]);

const { selectChangedFiles } = require("./select-changed-files.cjs");

module.exports = async function determineBuildMatrix({
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
  if (prNumber) {
    core.info(`Merged PR #${prNumber} changed ${changedFiles.length} files.`);
  } else {
    core.info(`Push changed ${changedFiles.length} files.`);
  }
  if (truncated) {
    // The file list was capped, so any specific change could be missing. Build
    // everything rather than guess wrong.
    core.warning(
      `Changed-file list was truncated at ${changedFiles.length}; building all targets.`
    );
  }

  const shouldBuildAll =
    truncated ||
    changedFiles.some(
      (file) =>
        TRIGGER_ALL_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
        TRIGGER_ALL_FILES.has(file)
    );

  const selectedApps = shouldBuildAll
    ? APP_ENTRIES
    : APP_ENTRIES.filter(({ app }) =>
        changedFiles.some((file) => file.startsWith(`apps/${app}/`))
      );

  const hasMobileChanges =
    truncated ||
    changedFiles.some(
      (file) =>
        file.startsWith("apps/mobile/") || MOBILE_TRIGGER_FILES.has(file)
    );
  core.setOutput("has-mobile-changes", hasMobileChanges ? "true" : "false");
  core.info(`Mobile app changes: ${hasMobileChanges}`);

  if (selectedApps.length === 0) {
    core.setOutput("matrix", JSON.stringify({ include: [] }));
    core.setOutput("has-app-changes", "false");
    core.setOutput("selected-apps", "");
    core.info("No app-specific changes detected; skipping Docker builds.");
    return;
  }

  const selectedAppNames = selectedApps.map(({ app }) => app);
  core.setOutput("matrix", JSON.stringify({ include: selectedApps }));
  core.setOutput("has-app-changes", "true");
  core.setOutput("selected-apps", selectedAppNames.join(","));
  core.info(`Selected Docker image builds: ${selectedAppNames.join(", ")}`);
};
