// Stable CLI entry point used by package scripts and the schema-sync image.
import { runPrebuildDmIndexes } from "./infrastructure/prebuild-indexes";

export { prebuildDmIndexes } from "./infrastructure/prebuild-indexes";

if (import.meta.main) {
  await runPrebuildDmIndexes().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
