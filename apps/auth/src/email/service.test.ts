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

interface ResendSendResult {
  data: { id: string } | null;
  error: { message: string } | null;
}

let throwOnSend = false;
let returnErrorOnSend = false;

const mockValidateEmailAdvanced = mock(
  async (): Promise<EmailValidationResult> => ({
    isValid: true,
    score: 100,
    confidence: "high",
    reasons: [],
    disposable: false,
    mxRecords: true,
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
  let envModule: typeof import("../../env");
  let serviceModule: typeof import("./service");

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

    console.error = mock(() => undefined) as typeof console.error;
    console.log = mock(() => undefined) as typeof console.log;
    console.warn = mock(() => undefined) as typeof console.warn;

    throwOnSend = false;
    returnErrorOnSend = false;

    // We must manually set up the envs before importing
    process.env.RESEND_API_KEY = "test_key";
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "test",
      writable: true,
    });
    process.env.NEXT_PUBLIC_URL = "https://social.localhost";
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
    Object.defineProperty(envModule.env, "NEXT_PUBLIC_URL", {
      value: "https://social.localhost",
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
      isValid: false,
      score: 0,
      confidence: "low",
      reasons: ["Invalid format"],
      disposable: false,
      mxRecords: false,
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
});
