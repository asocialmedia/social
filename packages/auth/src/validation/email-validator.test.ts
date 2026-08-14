import { describe, expect, mock, test } from "bun:test";

import { validateEmailAdvanced, validateEmailBasic } from "./email-validator";

type SmtpVerifierResult = {
  isCatchAll?: boolean;
  isRole?: boolean;
  wellFormed?: boolean;
} | null;

const mxResolver = mock((domain: string) => {
  if (domain === "gmail.com") {
    return [{ exchange: "alt1.gmail-smtp-in.l.google.com", priority: 10 }];
  }
  if (domain === "fake.fake.fake") {
    throw new Error("ENOTFOUND");
  }
  return [{ exchange: `mx.${domain}`, priority: 10 }];
});

mock.module("node:dns", () => ({
  promises: {
    resolveMx: mxResolver,
  },
}));

describe("email-validator", () => {
  describe("validateEmailBasic", () => {
    test("rejects invalid format", async () => {
      const result = await validateEmailBasic("invalid");
      expect(result.isValid).toBe(false);
      expect(result.reasons).toContain("Invalid email format");
    });

    test("handles no domain (edge case but blocked by basic format)", async () => {
      // "test@" is invalid format, so it hits the first check
      const result = await validateEmailBasic("test@");
      expect(result.isValid).toBe(false);
      expect(result.reasons).toContain("Invalid email format");
    });

    test("detects disposable email", async () => {
      const result = await validateEmailBasic("test@mailinator.com");
      expect(result.disposable).toBe(true);
      expect(result.reasons).toContain("Disposable email domain detected");
    });

    test("passes normal email", async () => {
      const result = await validateEmailBasic("hello@example.com");
      // Basic format +20, Not disposable +25, No suspicious +15 = 60
      expect(result.isValid).toBe(true);
      expect(result.score).toBe(60);
      expect(result.disposable).toBe(false);
    });

    test("detects suspicious patterns but not trusted provider", async () => {
      const result = await validateEmailBasic("test_spam@example.com");
      // Format +20, Not disposable +25 = 45, Suspicious -10 => score = 35. 35 < 40 isValid = false
      expect(result.isValid).toBe(false);
      expect(result.reasons).toContain("Contains suspicious keywords");
    });

    test("allows suspicious patterns for trusted providers", async () => {
      const result = await validateEmailBasic("test_spam@gmail.com");
      // Format +20, Not disposable +25, Suspicious but trusted +15 = 60
      expect(result.isValid).toBe(true);
      expect(result.reasons).toContain(
        "No suspicious keywords detected (trusted provider)"
      );
    });
  });

  describe("validateEmailAdvanced (with MX and SMTP)", () => {
    test("uses mocked mx resolver for deterministic checks", async () => {
      const result = await validateEmailAdvanced("hello@example.com", {
        skipSmtpCheck: true,
      });

      expect(mxResolver).toHaveBeenCalledWith("example.com");
      expect(result.mxRecords).toBe(true);
    });

    test("resolves MX records successfully", async () => {
      const result = await validateEmailAdvanced("test@gmail.com", {
        skipSmtpCheck: true,
      });
      expect(result.mxRecords).toBe(true); // Gmail has MX
    });

    test("fails MX records gracefully for fake domain", async () => {
      const result = await validateEmailAdvanced("test@fake.fake.fake", {
        skipSmtpCheck: true,
      });
      expect(result.mxRecords).toBe(false);
    });

    test("SMTP verifier success", async () => {
      const mockVerifier = mock(
        (_email: string, _timeoutMs: number): Promise<SmtpVerifierResult> =>
          Promise.resolve({
            isCatchAll: false,
            isRole: false,
            wellFormed: true,
          })
      );
      const result = await validateEmailAdvanced("hello@example.com", {
        skipMxCheck: true,
        skipSmtpCheck: false,
        smtpVerifier: mockVerifier,
      });
      expect(result.smtpCheck).toBe(true);
      expect(result.reasons).toContain("SMTP verification passed");
    });

    test("SMTP verifier catch all and role account", async () => {
      const mockVerifier = mock(
        (_email: string, _timeoutMs: number): Promise<SmtpVerifierResult> =>
          Promise.resolve({
            isCatchAll: true,
            isRole: true,
            wellFormed: true,
          })
      );
      const result = await validateEmailAdvanced("admin@example.com", {
        skipMxCheck: true,
        skipSmtpCheck: false,
        smtpVerifier: mockVerifier,
      });
      expect(result.catchAll).toBe(true);
      expect(result.roleAccount).toBe(true);
      expect(result.reasons).toContain("Catch-all domain detected");
      expect(result.reasons).toContain(
        "Role account detected (noreply, admin, etc.)"
      );
    });

    test("SMTP verifier trusted provider catch-all", async () => {
      const mockVerifier = mock(
        (_email: string, _timeoutMs: number): Promise<SmtpVerifierResult> =>
          Promise.resolve({
            isCatchAll: true,
            isRole: false,
            wellFormed: true,
          })
      );
      const result = await validateEmailAdvanced("test@gmail.com", {
        skipMxCheck: true,
        skipSmtpCheck: false,
        smtpVerifier: mockVerifier,
      });
      expect(result.catchAll).toBe(true);
      expect(result.reasons).toContain(
        "Catch-all domain detected (trusted provider)"
      );
    });

    test("SMTP verifier failure", async () => {
      const mockVerifier = mock(
        (_email: string, _timeoutMs: number): Promise<SmtpVerifierResult> =>
          Promise.resolve({ wellFormed: false })
      );
      const result = await validateEmailAdvanced("hello@example.com", {
        skipMxCheck: true,
        skipSmtpCheck: false,
        smtpVerifier: mockVerifier,
      });
      expect(result.smtpCheck).toBe(false);
      expect(result.reasons).toContain("SMTP verification failed");
    });

    test("SMTP verifier failure (trusted)", async () => {
      const mockVerifier = mock(
        (_email: string, _timeoutMs: number): Promise<SmtpVerifierResult> =>
          Promise.resolve({ wellFormed: false })
      );
      const result = await validateEmailAdvanced("test@gmail.com", {
        skipMxCheck: true,
        skipSmtpCheck: false,
        smtpVerifier: mockVerifier,
      });
      expect(result.smtpCheck).toBe(false);
      expect(result.reasons).toContain(
        "SMTP verification inconclusive (trusted provider)"
      );
    });

    test("SMTP verifier timeout/exception", async () => {
      const mockVerifier = mock(async () => {
        await Promise.resolve();
        throw new Error("Network error");
      });
      const result = await validateEmailAdvanced("hello@example.com", {
        skipMxCheck: true,
        skipSmtpCheck: false,
        smtpVerifier: mockVerifier,
      });
      expect(result.reasons).toContain("SMTP check timed out or failed");
    });

    test("SMTP check skipped when no verifier provided", async () => {
      const result = await validateEmailAdvanced("hello@example.com", {
        skipMxCheck: true,
        skipSmtpCheck: false,
      });
      expect(result.reasons).toContain(
        "SMTP check skipped (no verifier configured)"
      );
    });

    test("SMTP check skipped if disposable", async () => {
      const mockVerifier = mock(
        (_email: string, _timeoutMs: number): Promise<SmtpVerifierResult> =>
          Promise.resolve({ wellFormed: true })
      );
      const _result = await validateEmailAdvanced("test@mailinator.com", {
        skipMxCheck: true,
        skipSmtpCheck: false,
        smtpVerifier: mockVerifier,
      });
      // Should not be called
      expect(mockVerifier).not.toHaveBeenCalled();
    });
  });
});
