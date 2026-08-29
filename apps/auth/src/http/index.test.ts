import { beforeEach, describe, expect, mock, test } from "bun:test";

import { corsHeaders, createHttpHandler, getAllowedOrigin } from "./index";
import type { HttpLogger } from "./index";

const mockGetSession = mock((): Promise<unknown> => Promise.resolve(null));
const mockAuthHandler = mock((_request: Request) =>
  Promise.resolve(new Response("auth-ok"))
);
const mockTrpcFetchHandler = mock(() =>
  Promise.resolve(new Response("trpc-ok"))
);

function createHandler() {
  return createHttpHandler({
    appRouter: {} as Parameters<typeof createHttpHandler>[0]["appRouter"],
    authInstance: {
      api: { getSession: mockGetSession },
      handler: mockAuthHandler,
    },
    createContext: () => ({ session: null, user: null }),
    trpcFetchHandler: mockTrpcFetchHandler,
  });
}

describe("auth service http handler", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockAuthHandler.mockClear();
    mockTrpcFetchHandler.mockClear();
  });

  test("returns 404 for unknown paths", async () => {
    const handleRequest = createHandler();
    const res = await handleRequest(new Request("http://localhost/nope"));
    expect(res.status).toBe(404);
  });

  test("handles OPTIONS preflight with CORS headers", async () => {
    const handleRequest = createHandler();
    const res = await handleRequest(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "OPTIONS",
      })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000"
    );
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  test("GET /api/auth/get-session returns null session when unauthorized", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const handleRequest = createHandler();
    const res = await handleRequest(
      new Request("http://localhost/api/auth/get-session")
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockAuthHandler).not.toHaveBeenCalled();
  });

  test("GET /api/auth/get-session returns session when authorized", async () => {
    mockGetSession.mockResolvedValueOnce({
      session: { id: "s1", userId: "u1" },
      user: { id: "u1", username: "testuser" },
    });

    const handleRequest = createHandler();
    const res = await handleRequest(
      new Request("http://localhost/api/auth/get-session")
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe("s1");
    expect(body.user.username).toBe("testuser");
    expect(mockAuthHandler).not.toHaveBeenCalled();
  });

  test("routes better-auth requests to auth.handler with CORS", async () => {
    const req = new Request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
    });

    const handleRequest = createHandler();
    const res = await handleRequest(req);

    expect(mockAuthHandler).toHaveBeenCalledWith(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000"
    );
  });

  test("synthesizes origin for internal server-to-server requests without origin", async () => {
    const req = new Request(
      "http://localhost/api/auth/email-otp/send-verification-otp",
      {
        headers: {
          "content-type": "application/json",
          "x-internal-secret": "secret",
        },
        method: "POST",
      }
    );

    const handleRequest = createHandler();
    const res = await handleRequest(req);

    expect(res.status).toBe(200);
    expect(mockAuthHandler).toHaveBeenCalled();
    const passedReq = mockAuthHandler.mock.calls[0]?.[0] as Request;
    expect(passedReq.headers.get("origin")).toBe("http://localhost:3000");
    expect(passedReq.headers.get("referer")).toBe("http://localhost:3000/");
  });

  test.each([
    "/api/auth/pending-signup",
    "/api/auth/pending-verify",
    "/api/auth/pending-resend",
  ])("routes %s to the tRPC handler", async (path) => {
    const req = new Request(`http://localhost${path}`, { method: "POST" });

    const handleRequest = createHandler();
    const res = await handleRequest(req);

    expect(mockTrpcFetchHandler).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "/api/auth", req })
    );
    expect(mockAuthHandler).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  test("routes /api/trpc/* to the tRPC handler", async () => {
    const req = new Request(
      "http://localhost/api/trpc/securityHealth?input=%7B%7D"
    );

    const handleRequest = createHandler();
    const res = await handleRequest(req);

    expect(mockTrpcFetchHandler).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "/api/trpc", req })
    );
    expect(res.status).toBe(200);
  });

  test("corsHeaders reflect production origin", () => {
    const original = process.env.NODE_ENV;
    const originalUrl = process.env.APP_URL;
    try {
      process.env.NODE_ENV = "production";
      process.env.APP_URL = "https://asocialmedia.cc";
      expect(getAllowedOrigin()).toBe("https://asocialmedia.cc");
      expect(corsHeaders()["Access-Control-Allow-Origin"]).toBe(
        "https://asocialmedia.cc"
      );
    } finally {
      process.env.NODE_ENV = original;
      if (originalUrl === undefined) {
        delete process.env.APP_URL;
      } else {
        process.env.APP_URL = originalUrl;
      }
    }
  });
});

describe("oauth callback logging", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockAuthHandler.mockClear();
    mockTrpcFetchHandler.mockClear();
  });

  function createLoggingHandler() {
    const logs: { level: string; message: string }[] = [];
    const logger: HttpLogger = {
      debug: () => {},
      error: (obj: Record<string, unknown>, message?: string) => {
        logs.push({ level: "error", message: message ?? "" });
      },
      info: (obj: Record<string, unknown>, message?: string) => {
        logs.push({ level: "info", message: message ?? "" });
      },
      warn: (obj: Record<string, unknown>, message?: string) => {
        logs.push({ level: "warn", message: message ?? "" });
      },
    };
    const handler = createHttpHandler({
      appRouter: {} as Parameters<typeof createHttpHandler>[0]["appRouter"],
      authInstance: {
        api: { getSession: mockGetSession },
        handler: mockAuthHandler,
      },
      createContext: () => ({ session: null, user: null }),
      logger,
      trpcFetchHandler: mockTrpcFetchHandler,
    });
    return { handler, logs };
  }

  test("logs accepted oauth callbacks at info level", async () => {
    mockAuthHandler.mockImplementationOnce(() =>
      Promise.resolve(new Response(null, { status: 200 }))
    );
    const { handler, logs } = createLoggingHandler();

    await handler(
      new Request(
        "http://localhost/api/auth/callback/google?state=abc&code=xyz"
      )
    );

    const accepted = logs.find(
      (entry) => entry.message === "oauth callback accepted"
    );
    expect(accepted).toBeDefined();
  });

  test("logs rejected oauth callbacks with provider and state context", async () => {
    mockAuthHandler.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(null, {
          headers: {
            location:
              "http://localhost:3001/api/auth/error?error=state_mismatch",
          },
          status: 302,
        })
      )
    );
    const { handler, logs } = createLoggingHandler();

    await handler(
      new Request(
        "http://localhost/api/auth/callback/reddit?state=xyz987&error=access_denied"
      )
    );

    const rejected = logs.find(
      (entry) => entry.message === "oauth callback rejected"
    );
    expect(rejected).toBeDefined();
    expect(
      logs.some((entry) => entry.message === "oauth callback accepted")
    ).toBe(false);
  });

  test("does not log non-callback auth paths as oauth callbacks", async () => {
    const { handler, logs } = createLoggingHandler();

    await handler(
      new Request("http://localhost/api/auth/sign-in/email", { method: "POST" })
    );

    expect(
      logs.some((entry) => entry.message.startsWith("oauth callback"))
    ).toBe(false);
  });
});
