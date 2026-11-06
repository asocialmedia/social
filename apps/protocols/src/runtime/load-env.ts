import { existsSync } from "node:fs";
import path from "node:path";

import { config as loadEnv } from "dotenv";

export function loadProtocolsEnvironment(
  options: {
    appDirectory?: string;
    env?: Record<string, string | undefined>;
  } = {}
): void {
  const appDirectory =
    options.appDirectory ?? path.resolve(import.meta.dir, "../..");
  const env = options.env ?? process.env;
  env.NODE_ENV ??= "development";
  const files = [
    path.join(appDirectory, ".env.local"),
    path.join(appDirectory, ".env"),
    path.resolve(appDirectory, "../..", ".env"),
  ];
  if (env.NODE_ENV === "development") {
    files.push(path.join(appDirectory, ".env.development"));
  }
  // Injected values win, followed by local secrets, root secrets, and development defaults.
  for (const file of files) {
    if (existsSync(file)) {
      loadEnv({ override: false, path: file, processEnv: env, quiet: true });
    }
  }
}
