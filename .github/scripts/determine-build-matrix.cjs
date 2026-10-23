const APP_ENTRIES = [
  { app: "web", dockerfile: "./apps/web/Dockerfile", image: "asm-web" },
  { app: "auth", dockerfile: "./apps/auth/Dockerfile", image: "asm-auth" },
  {
    app: "media-processing",
    dockerfile: "./apps/media-processing/Dockerfile",
    image: "asm-media-processing",
  },
  {
    app: "protocols",
    dockerfile: "./apps/protocols/Dockerfile",
    image: "asm-protocols",
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

// Root dependency changes can affect mobile; release-only version stamps cannot.
const MOBILE_TRIGGER_FILES = new Set(["package.json", "bun.lock"]);

function isVersionOnlyChange(file) {
  if (
    file.status !== "modified" ||
    !file.patch ||
    !Number.isInteger(file.changes)
  ) {
    return false;
  }
  const versionLine =
    file.filename === "bun.lock"
      ? /^[-+] {6}"version": "\d+\.\d+\.\d+",?$/
      : /^[-+] {2}"version": "\d+\.\d+\.\d+",?$/;
  let changed = 0;
  let workspace = false;
  for (const line of file.patch.split("\n")) {
    if (line.startsWith("@@")) {
      workspace = false;
    }
    if (/^ {5}"(?:apps|packages)\/[^"/]+": \{$/.test(line)) {
      workspace = true;
    }
    if (!line.startsWith("+") && !line.startsWith("-")) {
      continue;
    }
    if (
      !versionLine.test(line) ||
      (file.filename === "bun.lock" && !workspace)
    ) {
      return false;
    }
    changed += 1;
  }
  // A missing or truncated patch must retain the conservative build decision.
  return changed > 0 && changed === file.changes;
}

const { selectChangedFiles } = require("./select-changed-files.cjs");

module.exports = async function determineBuildMatrix({
  github,
  context,
  core,
  prNumber,
}) {
  const { owner, repo } = context.repo;

  const {
    changes,
    files: changedFiles,
    truncated,
  } = await selectChangedFiles({
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
    changes.some(
      (file) =>
        file.filename.startsWith("apps/mobile/") ||
        (MOBILE_TRIGGER_FILES.has(file.filename) && !isVersionOnlyChange(file))
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
