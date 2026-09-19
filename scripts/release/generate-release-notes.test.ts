import { describe, expect, test } from "bun:test";

import { formatReleaseNotes } from "./generate-release-notes";
import type { ReleaseNotesOptions } from "./generate-release-notes";

describe("formatReleaseNotes", () => {
  const baseOptions: ReleaseNotesOptions = {
    authors: ["parazeeknova"],
    commits: [
      {
        author: "parazeeknova",
        message: "feat[mobile]: Implement 3D auth screen",
        sha: "c779d93c00000000000000000000000000000000",
      },
    ],
    containers: [
      {
        app: "Web Application",
        image: "ghcr.io/asocialmedia/asm-web",
        tag: "web-v1.0.2",
      },
    ],
    prNumber: 42,
    prTitle: "Mobile release",
    prUrl: "https://github.com/asocialmedia/social/pull/42",
    versions: {
      auth: "1.0.2",
      mediaProcessing: "1.0.2",
      mobile: "0.0.2",
      root: "1.5.80",
      web: "1.0.2",
    },
  };

  test("generates full markdown with header image, PR link, and versions", () => {
    const markdown = formatReleaseNotes(baseOptions);

    expect(markdown).toContain(
      'src="https://img.przknv.cc/t/Assets_zephyr-githubanner.jpg"'
    );
    expect(markdown).toContain("# Release v1.5.80");
    expect(markdown).toContain("[#42 - Mobile release]");
    expect(markdown).toContain("> **Contributors:** @parazeeknova");
    expect(markdown).toContain("### What's Changed");
    expect(markdown).toContain(
      "- feat\\[mobile\\]: Implement 3D auth screen (`c779d93`) by @parazeeknova"
    );
    expect(markdown).toContain("| **Monorepo Root** | `v1.5.80` |");
    expect(markdown).toContain(
      "| **Mobile Application (Android)** | `v0.0.2` |"
    );
    expect(markdown).toContain("| **Web Application** | `v1.0.2` |");
    expect(markdown).toContain(
      "| **Web Application** | `ghcr.io/asocialmedia/asm-web` | `web-v1.0.2` |"
    );
    expect(markdown).toContain(
      "*No mobile application update was included in this release.*"
    );
  });

  test("includes mobile artifact and sha256 checksum when provided", () => {
    const optionsWithArtifact: ReleaseNotesOptions = {
      ...baseOptions,
      mobileArtifact: {
        fileName: "asocialmedia-v0.0.2.apk",
        fileSize: "35 MB",
        sha256:
          "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0",
        version: "0.0.2",
      },
    };

    const markdown = formatReleaseNotes(optionsWithArtifact);

    expect(markdown).toContain("**asocialmedia-v0.0.2.apk**");
    expect(markdown).toContain("`v0.0.2`");
    expect(markdown).toContain("`35 MB`");
    expect(markdown).toContain(
      "`a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0`"
    );
    expect(markdown).toContain(
      'echo "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0  asocialmedia-v0.0.2.apk" | sha256sum -c'
    );
  });

  test("supports custom header image url", () => {
    const customHeader = "https://custom.cdn.cc/banner.jpg";
    const markdown = formatReleaseNotes({
      ...baseOptions,
      headerImageUrl: customHeader,
    });

    expect(markdown).toContain(`src="${customHeader}"`);
  });

  test("handles empty containers and commits gracefully", () => {
    const markdown = formatReleaseNotes({
      authors: [],
      commits: [],
      containers: [],
      versions: { root: "1.0.0" },
    });

    expect(markdown).toContain("- General maintenance and bug fixes.");
    expect(markdown).toContain(
      "*No new container images were published in this release.*"
    );
    expect(markdown).not.toContain("> **Contributors:**");
  });

  test("escapes Markdown metacharacters in untrusted PR titles and commits", () => {
    const markdown = formatReleaseNotes({
      ...baseOptions,
      commits: [
        {
          author: "mallory",
          message: "feat: [click](https://evil.example) **bold**",
          sha: "abcdef1234567890abcdef1234567890abcdef12",
        },
      ],
      prTitle: "Fix ](https://evil.example) injection",
    });

    expect(markdown).not.toContain("[click](https://evil.example)");
    expect(markdown).toContain("\\[click\\]\\(https://evil.example\\)");
    expect(markdown).toContain("\\*\\*bold\\*\\*");
    expect(markdown).not.toContain("](https://evil.example) injection");
    expect(markdown).toContain("\\]\\(https://evil.example\\) injection");
  });
});
