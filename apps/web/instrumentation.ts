import type { Instrumentation } from "next";

import { requestErrorAttributes } from "./src/lib/request-error";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeInstrumentation } =
      await import("./instrumentation-node");
    await registerNodeInstrumentation();
  }
}
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getWebLogger } = await import("./src/lib/otel");
    getWebLogger()?.error(
      requestErrorAttributes(error, request, context),
      "Next.js request failed"
    );
  }
};
