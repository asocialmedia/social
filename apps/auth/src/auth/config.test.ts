import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

type CreateAuthConfigInput = Parameters<
  typeof import("@asm/auth/core")["createAuthConfig"]
>[0];

type AuthConfigInput = Exclude<CreateAuthConfigInput, undefined>;

type VerificationOtpResult =
  | { success: true }
  | { error: string; success: false };

const mockSendVerificationOTP = mock(
  async (): Promise<VerificationOtpResult> => ({ success: true })
);
const mockSendVerificationEmail = mock(async () => ({
  success: true,
  verificationUrl: "url",
}));
const mockSendPasswordResetEmail = mock(async () => ({
  success: true,
  resetUrl: "url",
}));

mock.module("../email/service", () => ({
  sendVerificationOTP: mockSendVerificationOTP,
  sendVerificationEmail: mockSendVerificationEmail,
  sendPasswordResetEmail: mockSendPasswordResetEmail,
}));

const mockCreateAuthConfig = mock(
  (cfg: CreateAuthConfigInput = {}): CreateAuthConfigInput => cfg
);

mock.module("@asm/auth/core", () => ({
  createAuthConfig: mockCreateAuthConfig,
}));

process.env.DATABASE_URL = "postgresql://mock";
process.env.POSTGRES_PRISMA_URL = "postgresql://mock";
process.env.POSTGRES_URL_NON_POOLING = "postgresql://mock";
process.env.BETTER_AUTH_SECRET = "mock-secret-123456789012345678901234567890";
process.env.RESEND_API_KEY = "test_key";

describe("auth config wrappers", () => {
  let authConfig: AuthConfigInput;

  afterAll(() => {
    mock.restore();
  });

  beforeAll(async () => {
    mockCreateAuthConfig.mockClear();
    await import("./config");
    const configCall = mockCreateAuthConfig.mock.calls.at(-1)?.[0];

    if (!configCall) {
      throw new Error("Expected createAuthConfig to be called during import");
    }

    authConfig = configCall as AuthConfigInput;
  });

  beforeEach(() => {
    mockCreateAuthConfig.mockClear();
    mockSendVerificationOTP.mockClear();
    mockSendVerificationEmail.mockClear();
    mockSendPasswordResetEmail.mockClear();
  });

  test("exports configured auth object", () => {
    expect(authConfig).toBeDefined();
  });

  test("emailService methods wrap properly", async () => {
    const { emailService } = authConfig;

    if (
      !(
        emailService?.sendVerificationEmail &&
        emailService.sendPasswordResetEmail
      )
    ) {
      throw new Error("Expected emailService to be configured");
    }

    await emailService.sendVerificationEmail("test@example.com", "token123");
    expect(mockSendVerificationEmail).toHaveBeenCalledWith(
      "test@example.com",
      "token123"
    );

    await emailService.sendPasswordResetEmail("test@example.com", "token123");
    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
      "test@example.com",
      "token123"
    );
  });

  test("sendVerificationOTP wrapper success", async () => {
    const { sendVerificationOTP } = authConfig;

    if (!sendVerificationOTP) {
      throw new Error("Expected sendVerificationOTP to be configured");
    }

    await sendVerificationOTP({
      email: "test@example.com",
      otp: "123",
      type: "email-verification",
    });
    expect(mockSendVerificationOTP).toHaveBeenCalledWith(
      "test@example.com",
      "123"
    );
  });

  test("sendVerificationOTP wrapper throws if result not success", async () => {
    mockSendVerificationOTP.mockResolvedValueOnce({
      success: false,
      error: "Failed",
    });

    const { sendVerificationOTP } = authConfig;

    if (!sendVerificationOTP) {
      throw new Error("Expected sendVerificationOTP to be configured");
    }

    await expect(
      sendVerificationOTP({
        email: "test@example.com",
        otp: "123",
        type: "email-verification",
      })
    ).rejects.toThrow("Failed");
  });

  test("sendVerificationOTP wrapper throws on unsupported type", async () => {
    const { sendVerificationOTP } = authConfig;

    if (!sendVerificationOTP) {
      throw new Error("Expected sendVerificationOTP to be configured");
    }

    await expect(
      sendVerificationOTP({
        email: "test@example.com",
        otp: "123",
        type: "other",
      })
    ).rejects.toThrow("Unsupported verification type: other");
  });
});
