// Generates clean, structured GitHub Release notes for asocialmedia releases.

export interface ReleaseCommit {
  author: string;
  authorUrl?: string;
  message: string;
  sha: string;
}

export interface ContainerImageInfo {
  app: string;
  image: string;
  tag: string;
}

export interface MobileArtifactInfo {
  fileName: string;
  fileSize: string;
  sha256: string;
  version: string;
}

export interface WorkspaceVersions {
  auth?: string;
  mediaProcessing?: string;
  mobile?: string;
  root: string;
  web?: string;
}

export interface ReleaseNotesOptions {
  authors: string[];
  commits: ReleaseCommit[];
  containers: ContainerImageInfo[];
  headerImageUrl?: string;
  mobileArtifact?: MobileArtifactInfo;
  prNumber?: number;
  prTitle?: string;
  prUrl?: string;
  versions: WorkspaceVersions;
}

const DEFAULT_HEADER_IMAGE =
  "https://img.przknv.cc/t/Assets_zephyr-githubanner.jpg";

export function formatReleaseNotes(options: ReleaseNotesOptions): string {
  const headerUrl = options.headerImageUrl || DEFAULT_HEADER_IMAGE;

  // Header banner
  const sections: string[] = [
    `<p align="center">\n  <img src="${headerUrl}" alt="asocialmedia release header" width="100%" />\n</p>`,
    `# Release v${options.versions.root}`,
  ];

  // PR context and contributors
  const metaLines: string[] = [];
  if (options.prNumber) {
    const titlePart = options.prTitle ? ` - ${options.prTitle}` : "";
    const prLink = options.prUrl
      ? `[#${options.prNumber}${titlePart}](${options.prUrl})`
      : `#${options.prNumber}${titlePart}`;
    metaLines.push(`> **Pull Request:** ${prLink}`);
  }

  if (options.authors.length > 0) {
    const formattedAuthors = options.authors
      .map((author) => (author.startsWith("@") ? author : `@${author}`))
      .join(", ");
    metaLines.push(`> **Contributors:** ${formattedAuthors}`);
  }

  if (metaLines.length > 0) {
    sections.push(metaLines.join("\n"));
  }

  // Commits section
  sections.push("---");
  sections.push("### What's Changed");

  if (options.commits.length > 0) {
    const commitLines = options.commits.map((commit) => {
      const shortSha = commit.sha.slice(0, 7);
      const cleanMessage = commit.message.split("\n")[0].trim();
      const authorText = commit.authorUrl
        ? `by [@${commit.author.replace(/^@/, "")}](${commit.authorUrl})`
        : `by @${commit.author.replace(/^@/, "")}`;
      return `- ${cleanMessage} (\`${shortSha}\`) ${authorText}`;
    });
    sections.push(commitLines.join("\n"));
  } else {
    sections.push("- General maintenance and bug fixes.");
  }

  // Workspace Versions table
  sections.push("---");
  sections.push("### Workspace & App Versions");
  const versionRows: string[] = [
    "| Component | Version | Package |",
    "| :--- | :--- | :--- |",
    `| **Monorepo Root** | \`v${options.versions.root}\` | \`@asocialmedia/social\` |`,
  ];

  if (options.versions.web) {
    versionRows.push(
      `| **Web Application** | \`v${options.versions.web}\` | \`@asm/web\` |`
    );
  }
  if (options.versions.auth) {
    versionRows.push(
      `| **Auth Service** | \`v${options.versions.auth}\` | \`@asm/auth-app\` |`
    );
  }
  if (options.versions.mediaProcessing) {
    versionRows.push(
      `| **Media Processing** | \`v${options.versions.mediaProcessing}\` | \`@asm/media-processing\` |`
    );
  }
  if (options.versions.mobile) {
    versionRows.push(
      `| **Mobile Application (Android)** | \`v${options.versions.mobile}\` | \`@asocialmedia/mobile\` |`
    );
  }
  sections.push(versionRows.join("\n"));

  // Container Images section
  sections.push("---");
  sections.push("### Container Images (GHCR)");
  if (options.containers.length > 0) {
    const containerRows: string[] = [
      "| Service | Image | Tag | Architectures |",
      "| :--- | :--- | :--- | :--- |",
    ];
    for (const c of options.containers) {
      containerRows.push(
        `| **${c.app}** | \`${c.image}\` | \`${c.tag}\` | \`linux/amd64\`, \`linux/arm64\` |`
      );
    }
    sections.push(containerRows.join("\n"));
  } else {
    sections.push("*No new container images were published in this release.*");
  }

  // Mobile Artifacts section
  sections.push("---");
  sections.push("### Mobile Artifacts (Android)");
  if (options.mobileArtifact) {
    const { fileName, fileSize, sha256, version } = options.mobileArtifact;
    const artifactTable = [
      "| File | Version | Size | SHA-256 Checksum |",
      "| :--- | :--- | :--- | :--- |",
      `| **${fileName}** | \`v${version}\` | \`${fileSize}\` | \`${sha256}\` |`,
    ].join("\n");

    const checksumVerification = [
      "<details>",
      "<summary><b>Verify SHA-256 Checksum</b></summary>\n",
      "```bash",
      `echo "${sha256}  ${fileName}" | sha256sum -c`,
      "```",
      "</details>",
    ].join("\n");

    sections.push(`${artifactTable}\n\n${checksumVerification}`);
  } else {
    sections.push(
      "*No mobile application update was included in this release.*"
    );
  }

  return sections.join("\n\n");
}
