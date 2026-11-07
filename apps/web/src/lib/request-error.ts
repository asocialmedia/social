import type { Instrumentation } from "next";

export function requestErrorAttributes(
  error: Parameters<Instrumentation.onRequestError>[0],
  request: Parameters<Instrumentation.onRequestError>[1],
  context: Parameters<Instrumentation.onRequestError>[2]
) {
  return {
    digest:
      typeof error === "object" && error !== null && "digest" in error
        ? String(error.digest)
        : undefined,
    event: "web.request_error",
    hasServerAction: Boolean(request.headers["next-action"]),
    method: request.method,
    renderSource: context.renderSource,
    revalidateReason: context.revalidateReason,
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
  };
}
