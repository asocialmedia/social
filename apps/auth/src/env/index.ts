import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config as loadEnv } from "dotenv";

function findRootEnvFile(): string | null {
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

export function loadRootEnv(): void {
  const rootEnv = findRootEnvFile();
  if (rootEnv) {
    loadEnv({ path: rootEnv, quiet: true, override: true });
  }

  const nodeEnv = process.env.NODE_ENV ?? "development";
  const appEnv = join(process.cwd(), `.env.${nodeEnv}`);
  if (existsSync(appEnv)) {
    loadEnv({ path: appEnv, quiet: true, override: true });
  }
}
