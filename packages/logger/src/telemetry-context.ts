import { AsyncResource } from "node:async_hooks";

import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import { suppressTracing } from "@opentelemetry/core";

// Bind during telemetry initialization, before any requests are rendered.
// Clearing only OpenTelemetry context leaves Next's render stores attached.
export function bindTelemetryExport<Arguments extends unknown[], Result>(
  // eslint-disable-next-line promise/prefer-await-to-callbacks -- SDK exporters require synchronous callback signatures.
  callback: (...args: Arguments) => Result
): (...args: Arguments) => Result {
  const exportContext = suppressTracing(ROOT_CONTEXT);
  return AsyncResource.bind(
    (...args: Arguments) =>
      context.with(exportContext, callback, undefined, ...args),
    "asm.telemetry.export"
  );
}
