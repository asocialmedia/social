import type { Instrumentation } from "next";

const networkCodes = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

export function isExpectedNextNavigation(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (value === "NEXT_REDIRECT" ||
      value.startsWith("NEXT_REDIRECT;") ||
      value === "NEXT_HTTP_ERROR_FALLBACK;404")
  );
}

export function requestNetworkErrorCodes(errors: unknown[]): string[] {
  const codes = new Set<string>();
  const pending = errors.slice(0, 8);
  for (let index = 0; index < pending.length && index < 16; index += 1) {
    const error = pending[index];
    if (!(error instanceof Error)) {
      continue;
    }
    if (
      "code" in error &&
      typeof error.code === "string" &&
      networkCodes.has(error.code)
    ) {
      codes.add(error.code);
    }
    if (error.cause) {
      pending.push(error.cause);
    }
    if (error instanceof AggregateError) {
      pending.push(...error.errors.slice(0, 8));
    }
  }
  return [...codes].toSorted();
}

export function requestErrorAttributes(
  error: Parameters<Instrumentation.onRequestError>[0],
  request: Parameters<Instrumentation.onRequestError>[1],
  context: Parameters<Instrumentation.onRequestError>[2]
) {
  const networkErrorCodes = requestNetworkErrorCodes([error]);
  return {
    digest:
      typeof error === "object" && error !== null && "digest" in error
        ? String(error.digest)
        : undefined,
    event: "web.request_error",
    hasServerAction: Boolean(request.headers["next-action"]),
    method: request.method,
    ...(networkErrorCodes.length ? { networkErrorCodes } : {}),
    renderSource: context.renderSource,
    revalidateReason: context.revalidateReason,
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
  };
}
