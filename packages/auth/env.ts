import { createEnv } from "@t3-oss/env-core";

import { keys as base } from "./keys";

export const env = createEnv({
  extends: [base],
  runtimeEnv: {},
  server: {},
});
