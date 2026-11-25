import type { Instrumentation } from "next";

import {
  isExpectedNextNavigation,
  requestErrorAttributes,
} from "./src/lib/request-error";

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
    const attributes = requestErrorAttributes(error, request, context);
    if (isExpectedNextNavigation(attributes.digest)) {
      return;
    }
    const { getWebLogger } = await import("./src/lib/otel");
    getWebLogger()?.error(attributes, "Next.js request failed");
  }
};
