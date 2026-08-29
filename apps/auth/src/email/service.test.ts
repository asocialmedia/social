import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

import type { EmailValidationResult } from "@asm/auth";

import type { env } from "../../env";
import type {
  isDevelopmentMode,
  isEmailServiceConfigured,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendVerificationOTP,
  validateEmailServiceConfig,
} from "./service";

interface EnvModule {
  env: typeof env;
}

interface ServiceModule {
  __resetResend?: () => void;
  isDevelopmentMode: typeof isDevelopmentMode;
  isEmailServiceConfigured: typeof isEmailServiceConfigured;
  sendPasswordResetEmail: typeof sendPasswordResetEmail;
  sendVerificationEmail: typeof sendVerificationEmail;
  sendVerificationOTP: typeof sendVerificationOTP;
  validateEmailServiceConfig: typeof validateEmailServiceConfig;
}

interface ResendSendResult {
  data: { id: string } | null;
  error: { message: string } | null;
}

let throwOnSend = false;
let returnErrorOnSend = false;

const mockValidateEmailAdvanced = mock((): Promise<EmailValidationResult> =>
  Promise.resolve({
    confidence: "high",
    disposable: false,
    isValid: true,
    mxRecords: true,
    reasons: [],
    score: 100,
  })
) as {
  mockClear: () => void;
  mockResolvedValueOnce: (value: EmailValidationResult) => unknown;
};

const mockResendSend = mock(async (): Promise<ResendSendResult> => {
  await Promise.resolve();
  if (throwOnSend) {
    throw new Error("Send exception");
  }
  if (returnErrorOnSend) {
    return { data: null, error: { message: "Send error" } };
  }
  return { data: { id: "123" }, error: null };
});

const originalConsole = {
  error: console.error,
  log: console.log,
  warn: console.warn,
};

describe("email service", () => {
  let envModule: EnvModule;
  let serviceModule: ServiceModule;

  beforeEach(async () => {
    mock.restore();

    mock.module("@asm/auth", () => ({
      validateEmailAdvanced: mockValidateEmailAdvanced,
    }));

    mock.module("resend", () => ({
      Resend: class MockResend {
        constructor(key: string) {
          if (key === "throw_init") {
            throw new Error("Init error");
          }
        }

        emails = {
          send: mockResendSend,
        };
      },
    }));

    console.error = mock(() => {}) as typeof console.error;
    console.log = mock(() => {}) as typeof console.log;
    console.warn = mock(() => {}) as typeof console.warn;

    throwOnSend = false;
    returnErrorOnSend = false;

    // We must manually set up the envs before importing. Plain assignment
    // only: NODE_ENV arrives from the real environment, where Bun marks
    // process.env descriptors non-configurable, so defineProperty throws.
    process.env.RESEND_API_KEY = "test_key";
    process.env.NODE_ENV = "test";
    process.env.APP_URL = "http://localhost:3000";
    process.env.DATABASE_URL = "postgresql://mock";
    process.env.POSTGRES_PRISMA_URL = "postgresql://mock";
    process.env.POSTGRES_URL_NON_POOLING = "postgresql://mock";
    process.env.BETTER_AUTH_SECRET =
      "mock-secret-123456789012345678901234567890";

    envModule = await import("../../env");
    // Ensure the runtime env overrides catch the manual sets
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    Object.defineProperty(envModule.env, "NODE_ENV", {
      value: "development",
      writable: true,
    });
    Object.defineProperty(envModule.env, "APP_URL", {
      value: "http://localhost:3000",
      writable: true,
    });

    serviceModule = await import("./service");
    serviceModule.__resetResend?.();
  });

  afterEach(() => {
    console.error = originalConsole.error;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;

    mockValidateEmailAdvanced.mockClear();
    mockResendSend.mockClear();
  });

  afterAll(() => {
    mock.restore();
  });

  test("validateEmailServiceConfig works", () => {
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    expect(serviceModule.validateEmailServiceConfig().isValid).toBe(true);

    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "",
      writable: true,
    });
    expect(serviceModule.validateEmailServiceConfig().isValid).toBe(false);
  });

  test("isEmailServiceConfigured and isDevelopmentMode", () => {
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    expect(serviceModule.isEmailServiceConfigured()).toBe(true);

    Object.defineProperty(envModule.env, "NODE_ENV", {
      value: "development",
      writable: true,
    });
    expect(serviceModule.isDevelopmentMode()).toBe(true);
  });

  test("sendVerificationEmail sends successfully", async () => {
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    const result = await serviceModule.sendVerificationEmail(
      "test@example.com",
      "token123"
    );
    expect(result.success).toBe(true);
  });

  test("sendVerificationEmail handles non-dev mode", async () => {
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    Object.defineProperty(envModule.env, "NODE_ENV", {
      value: "production",
      writable: true,
    });
    const result = await serviceModule.sendVerificationEmail(
      "test@example.com",
      "token123"
    );
    expect(result.success).toBe(true);
  });

  test("sendVerificationEmail returns error from resend", async () => {
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    returnErrorOnSend = true;
    const result = await serviceModule.sendVerificationEmail(
      "test@example.com",
      "token123"
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Send error");
  });

  test("sendVerificationEmail catches exceptions", async () => {
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    throwOnSend = true;
    const result = await serviceModule.sendVerificationEmail(
      "test@example.com",
      "token123"
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Send exception");
  });

  test("sendVerificationEmail catches validation error", async () => {
    mockValidateEmailAdvanced.mockResolvedValueOnce({
      confidence: "low",
      disposable: false,
      isValid: false,
      mxRecords: false,
      reasons: ["Invalid format"],
      score: 0,
    });

    const result = await serviceModule.sendVerificationEmail(
      "bad@email",
      "token"
    );
    expect(result.success).toBe(false);
  });

  test("sendVerificationOTP sends successfully", async () => {
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    const result = await serviceModule.sendVerificationOTP(
      "test@example.com",
      "123456"
    );
    expect(result.success).toBe(true);
  });

  test("sendVerificationOTP handles non-dev mode", async () => {
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    Object.defineProperty(envModule.env, "NODE_ENV", {
      value: "production",
      writable: true,
    });
    const result = await serviceModule.sendVerificationOTP(
      "test@example.com",
      "123456"
    );
    expect(result.success).toBe(true);
  });

  test("sendVerificationOTP returns error from resend", async () => {
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    returnErrorOnSend = true;
    const result = await serviceModule.sendVerificationOTP(
      "test@example.com",
      "123456"
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Send error");
  });

  test("sendVerificationOTP catches exceptions", async () => {
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    throwOnSend = true;
    const result = await serviceModule.sendVerificationOTP(
      "test@example.com",
      "123456"
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Send exception");
  });

  test("sendPasswordResetEmail sends successfully", async () => {
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    const result = await serviceModule.sendPasswordResetEmail(
      "test@example.com",
      "token123"
    );
    expect(result.success).toBe(true);
  });

  test("sendPasswordResetEmail handles non-dev mode", async () => {
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    Object.defineProperty(envModule.env, "NODE_ENV", {
      value: "production",
      writable: true,
    });
    const result = await serviceModule.sendPasswordResetEmail(
      "test@example.com",
      "token123"
    );
    expect(result.success).toBe(true);
  });

  test("sendPasswordResetEmail returns error from resend", async () => {
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    returnErrorOnSend = true;
    const result = await serviceModule.sendPasswordResetEmail(
      "test@example.com",
      "token123"
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Send error");
  });

  test("sendPasswordResetEmail catches exceptions", async () => {
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    throwOnSend = true;
    const result = await serviceModule.sendPasswordResetEmail(
      "test@example.com",
      "token123"
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Send exception");
  });

  test("all emails are sent from Zeph <noreply@asocialmedia.cc>", async () => {
    Object.defineProperty(envModule.env, "RESEND_API_KEY", {
      value: "test_key",
      writable: true,
    });
    Object.defineProperty(envModule.env, "NODE_ENV", {
      value: "test",
      writable: true,
    });

    await serviceModule.sendVerificationEmail("user@example.com", "tok");
    await serviceModule.sendVerificationOTP("user@example.com", "123456");
    await serviceModule.sendPasswordResetEmail("user@example.com", "tok");

    const sendCalls = mockResendSend.mock.calls as unknown as {
      from?: string;
    }[][];
    expect(sendCalls.length).toBeGreaterThanOrEqual(3);

    for (const call of sendCalls) {
      expect(call[0].from).toBe("Zeph <noreply@asocialmedia.cc>");
    }
  });
});
