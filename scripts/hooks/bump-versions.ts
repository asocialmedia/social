#!/usr/bin/env bun

import { runBumpVersions } from "./bump-versions-lib";

(async () => {
  try {
    await runBumpVersions();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[bump-versions] ${message}`);
    process.exit(1);
  }
})();
