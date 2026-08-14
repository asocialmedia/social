import { existsSync } from "node:fs";
import path from "node:path";

import { config as loadEnv } from "dotenv";

function findRootEnvFile(): string | null {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

export function loadRootEnv(): void {
  const rootEnv = findRootEnvFile();
  if (rootEnv) {
    loadEnv({ override: true, path: rootEnv, quiet: true });
  }

  const nodeEnv = process.env.NODE_ENV ?? "development";
  const appEnv = path.join(process.cwd(), `.env.${nodeEnv}`);
  if (existsSync(appEnv)) {
    loadEnv({ override: true, path: appEnv, quiet: true });
  }
}
