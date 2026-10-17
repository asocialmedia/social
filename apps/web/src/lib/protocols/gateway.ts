import {
  getClientIpFromHeaders,
  getTrustedIngressIp,
  hashViewerId,
} from "@asm/db";
import { abortable, readJsonBounded } from "@asm/protocols/discovery";

import { getWebLogger } from "@/lib/otel";

import { consumeProtocolBudget, ProtocolBudgetError } from "./budget";
import { protocolGuest } from "./guest";

export { consumeProtocolBudget } from "./budget";

export class ProtocolGatewayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: number;
  constructor(status: number, code: string, retryAfter = 2) {
    super(code);
    this.name = "ProtocolGatewayError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

let active = 0;

export async function protocolJsonBody(
  request: Request,
  maxBytes = 2048
): Promise<unknown> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new ProtocolGatewayError(415, "unsupported_content_type");
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ProtocolGatewayError(403, "cross_origin");
  }
  const origin = request.headers.get("origin");
  const allowedOrigin =
    process.env.NODE_ENV === "production"
      ? process.env.NEXT_PUBLIC_URL
      : new URL(request.url).origin;
  if (
    origin &&
    origin !== (allowedOrigin ? new URL(allowedOrigin).origin : undefined)
  ) {
    throw new ProtocolGatewayError(403, "cross_origin");
  }
  try {
    return await readJsonBounded(
      request,
      maxBytes,
      AbortSignal.any([request.signal, AbortSignal.timeout(3000)])
    );
  } catch {
    throw new ProtocolGatewayError(400, "invalid_body");
  }
}

export async function protocolRoute(
  request: Request,
  operation: "discovery" | "feedback",
  run: (id: string) => Promise<Response>
): Promise<Response> {
  const supplied = request.headers.get("x-request-id");
  const id =
    supplied && /^[A-Za-z0-9._-]{1,96}$/.test(supplied)
      ? supplied
      : crypto.randomUUID();
  const startedAt = performance.now();
  const guest = protocolGuest(request);
  const headers = {
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "x-request-id": id,
  };
  if (active >= 128) {
    return Response.json(
      { error: "Bluesky is busy. Try again shortly." },
      { headers: { ...headers, "retry-after": "2" }, status: 503 }
    );
  }
  active += 1;
  let response: Response;
  let code = "ok";
  try {
    const ip =
      process.env.NODE_ENV === "production"
        ? getTrustedIngressIp(request.headers)
        : getClientIpFromHeaders(request.headers);
    const kind = operation === "feedback" ? "feedback" : "read";
    await abortable(
      Promise.all([
        consumeProtocolBudget("service", kind, false, "global"),
        consumeProtocolBudget(guest.identity, kind, false, "guest"),
        consumeProtocolBudget(hashViewerId(ip), kind),
      ]),
      AbortSignal.any([request.signal, AbortSignal.timeout(2500)])
    );
    response = await abortable(
      run(id),
      AbortSignal.any([request.signal, AbortSignal.timeout(20_000)])
    );
  } catch (error) {
    let failure = new ProtocolGatewayError(503, "dependency_unavailable");
    if (error instanceof ProtocolBudgetError) {
      failure = new ProtocolGatewayError(429, "rate_limited", error.retryAfter);
    } else if (error instanceof ProtocolGatewayError) {
      failure = error;
    }
    ({ code } = failure);
    let message = "Bluesky is temporarily unavailable";
    if (failure.status === 410) {
      message = "Refresh to load a new Bluesky feed";
    } else if (failure.status === 429) {
      message = "Too many requests. Try again shortly.";
    } else if (failure.status < 500) {
      message = "Invalid protocol request";
    }
    response = Response.json({ error: message }, { status: failure.status });
    if (failure.status === 429 || failure.status >= 500) {
      response.headers.set(
        "retry-after",
        String(Math.max(1, failure.retryAfter))
      );
    }
  } finally {
    active -= 1;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (
      key === "cache-control" &&
      response.headers.get("content-type")?.startsWith("text/event-stream")
    ) {
      response.headers.set(key, "private, no-store, no-transform");
      continue;
    }
    response.headers.set(key, value);
  }
  if (guest.cookie) {
    response.headers.append("set-cookie", guest.cookie);
  }
  const fields = {
    code,
    durationMs: Math.round(performance.now() - startedAt),
    event: "protocols.gateway",
    operation,
    requestId: id,
    status: response.status,
  };
  if (response.status >= 500) {
    getWebLogger()?.warn(fields, "Protocol gateway dependency failed");
  } else {
    getWebLogger()?.debug(fields, "Protocol gateway request completed");
  }
  return response;
}
