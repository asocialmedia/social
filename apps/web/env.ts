import { createEnv } from "@t3-oss/env-nextjs";

import { keys as base } from "./keys";

export const env = createEnv({
  client: {},
  extends: [base],
  runtimeEnv: {},
  server: {},
});
