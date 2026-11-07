import { AsyncResource } from "node:async_hooks";

import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import { suppressTracing } from "@opentelemetry/core";

// Loaded by startup telemetry initialization, before requests are rendered.
// Reuse this resource even when a logger is later created inside a request.
// Next can load separate module copies for instrumentation and route bundles.
const resourceKey = Symbol.for("@asm/logger/telemetry-export-resource");
const telemetryGlobals = globalThis as typeof globalThis & {
  [resourceKey]?: AsyncResource;
};
telemetryGlobals[resourceKey] ??= new AsyncResource("asm.telemetry.export");
const exportResource = telemetryGlobals[resourceKey];

// Clearing only OpenTelemetry context leaves Next's render stores attached.
export function bindTelemetryExport<Arguments extends unknown[], Result>(
  // eslint-disable-next-line promise/prefer-await-to-callbacks -- SDK exporters require synchronous callback signatures.
  callback: (...args: Arguments) => Result
): (...args: Arguments) => Result {
  const exportContext = suppressTracing(ROOT_CONTEXT);
  return exportResource.bind((...args: Arguments) =>
    context.with(exportContext, callback, undefined, ...args)
  );
}
