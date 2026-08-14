/** biome-ignore-all lint/performance/useTopLevelRegex: simple check */
import disposableEmailDomains from "disposable-email-domains";
// biome-ignore lint/performance/noNamespaceImport: This library uses a namespace export
import * as emailValidator from "email-validator";

export interface EmailValidationResult {
  catchAll?: boolean;
  confidence: "low" | "medium" | "high";
  disposable: boolean;
  isValid: boolean;
  mxRecords: boolean;
  reasons: string[];
  roleAccount?: boolean;
  score: number;
  smtpCheck?: boolean;
}

export interface EmailValidationOptions {
  skipMxCheck?: boolean;
  skipSmtpCheck?: boolean;
  smtpVerifier?: (
    email: string,
    timeoutMs: number
  ) => Promise<{
    wellFormed?: boolean;
    isCatchAll?: boolean;
    isRole?: boolean;
  } | null>;
  timeout?: number;
}

function getConfidence(
  score: number,
  highThreshold: number,
  mediumThreshold: number
): "high" | "low" | "medium" {
  if (score >= highThreshold) {
    return "high";
  }
  if (score >= mediumThreshold) {
    return "medium";
  }
  return "low";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This function is complex due to multiple validation steps
export async function validateEmailAdvanced(
  email: string,
  options: EmailValidationOptions = {}
): Promise<EmailValidationResult> {
  const { skipSmtpCheck = true, skipMxCheck = false, timeout = 5000 } = options;

  const result: EmailValidationResult = {
    confidence: "low",
    disposable: false,
    isValid: false,
    mxRecords: false,
    reasons: [],
    score: 0,
  };

  // Basic format validation (weight: 20)
  if (!emailValidator.validate(email)) {
    result.reasons.push("Invalid email format");
    return result;
  }
  result.score += 20;
  result.reasons.push("Valid email format");

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) {
    result.reasons.push("No domain found");
    return result;
  }

  const trustedEmailDomains = new Set<string>([
    "gmail.com",
    "outlook.com",
    "msn.com",
    "yahoo.com",
    "icloud.com",
    "proton.me",
    "protonmail.com",
  ]);

  if (disposableEmailDomains.includes(domain)) {
    result.disposable = true;
    result.reasons.push("Disposable email domain detected");
    result.score = Math.max(5, result.score - 15);
  } else {
    result.score += 25;
    result.reasons.push("Not a disposable email domain");
  }

  // Check for suspicious patterns (weight: 15)
  const suspiciousPatterns = [
    /temp/i,
    /fake/i,
    /spam/i,
    /trash/i,
    /junk/i,
    /burner/i,
    /throwaway/i,
    /temporary/i,
    /disposable/i,
    /test/i,
  ];

  const hasSuspiciousKeywords = suspiciousPatterns.some((pattern) =>
    pattern.test(email)
  );
  if (hasSuspiciousKeywords) {
    if (trustedEmailDomains.has(domain)) {
      // Ignore suspicious keywords for trusted consumer providers to reduce false negatives
      result.score += 15;
      result.reasons.push("No suspicious keywords detected (trusted provider)");
    } else {
      result.score = Math.max(0, result.score - 10);
      result.reasons.push("Contains suspicious keywords");
    }
  } else {
    result.score += 15;
    result.reasons.push("No suspicious keywords detected");
  }

  if (skipMxCheck && skipSmtpCheck) {
    result.isValid = result.score >= 40;
    result.confidence = getConfidence(result.score, 60, 40);
    return result;
  }

  // MX record check (weight: 20)
  if (!skipMxCheck) {
    const isNodeRuntime =
      typeof (globalThis as { process?: { versions?: { node?: string } } })
        .process?.versions?.node === "string";
    if (isNodeRuntime) {
      try {
        const dns = await import("node:dns").then((m) => m.promises);
        const mxRecords = await dns.resolveMx(domain);

        if (mxRecords && mxRecords.length > 0) {
          result.mxRecords = true;
          result.score += 20;
          result.reasons.push("MX records found");
        } else {
          result.reasons.push("No MX records found");
          result.score = Math.max(0, result.score - 15);
        }
      } catch {
        result.reasons.push("MX record check failed");
        result.score = Math.max(0, result.score - 5);
      }
    } else {
      result.reasons.push("MX check skipped (non-Node runtime)");
    }
  }

  // SMTP verification (weight: 20) - most expensive, skip by default
  if (!(skipSmtpCheck || result.disposable)) {
    const { smtpVerifier } = options;
    if (smtpVerifier) {
      try {
        const verification = await Promise.race<{
          wellFormed?: boolean;
          isCatchAll?: boolean;
          isRole?: boolean;
        } | null>([
          smtpVerifier(email, timeout),
          // eslint-disable-next-line promise/avoid-new
          new Promise<null>((_resolve, reject) => {
            setTimeout(() => {
              reject(new Error("Timeout"));
            }, timeout);
          }),
        ]);

        result.smtpCheck = verification?.wellFormed ?? false;
        result.catchAll = verification?.isCatchAll ?? false;
        result.roleAccount = verification?.isRole ?? false;

        if (verification?.wellFormed) {
          result.score += 20;
          result.reasons.push("SMTP verification passed");
        } else if (verification) {
          result.reasons.push(
            trustedEmailDomains.has(domain)
              ? "SMTP verification inconclusive (trusted provider)"
              : "SMTP verification failed"
          );
          if (!trustedEmailDomains.has(domain)) {
            result.score = Math.max(0, result.score - 15);
          }
        } else {
          result.reasons.push("SMTP verification unavailable");
        }

        if (result.catchAll) {
          result.reasons.push(
            trustedEmailDomains.has(domain)
              ? "Catch-all domain detected (trusted provider)"
              : "Catch-all domain detected"
          );
          if (!trustedEmailDomains.has(domain)) {
            result.score = Math.max(0, result.score - 5);
          }
        }

        if (result.roleAccount) {
          result.reasons.push("Role account detected (noreply, admin, etc.)");
          result.score = Math.max(0, result.score - 5);
        }
      } catch {
        result.reasons.push("SMTP check timed out or failed");
      }
    } else {
      result.reasons.push("SMTP check skipped (no verifier configured)");
    }
  }

  result.isValid = result.score >= 50;
  result.confidence = getConfidence(result.score, 80, 60);
  return result;
}

export function validateEmailBasic(
  email: string
): Promise<EmailValidationResult> {
  return validateEmailAdvanced(email, {
    skipMxCheck: true,
    skipSmtpCheck: true,
  });
}
