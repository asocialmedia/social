import type { Instrumentation } from "next";

import { getWebLogger } from "./src/lib/otel";
import { requestErrorAttributes } from "./src/lib/request-error";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeInstrumentation } =
      await import("./instrumentation-node");
    await registerNodeInstrumentation();
  }
}
export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context
) => {
  getWebLogger()?.error(
    requestErrorAttributes(error, request, context),
    "Next.js request failed"
  );
};
