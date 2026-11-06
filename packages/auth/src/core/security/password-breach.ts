import { createHash } from "node:crypto";

import { getTelemetryApi } from "@asm/logger";

const PWNED_PASSWORDS_API = "https://api.pwnedpasswords.com/range";
const PASSWORD_CHECK_TIMEOUT_MS = 5000;

let hibpUnavailableCounter: ReturnType<
  ReturnType<typeof getTelemetryApi>["meter"]["createCounter"]
> | null = null;

function recordHibpUnavailable(): void {
  try {
    if (!hibpUnavailableCounter) {
      hibpUnavailableCounter = getTelemetryApi().meter.createCounter(
        "auth.password_breach_unavailable_total",
        { description: "HIBP password-safety checks that failed to complete" }
      );
    }
    hibpUnavailableCounter.add(1);
  } catch {
    // Telemetry must never break the signup flow.
  }
}

export class PasswordSafetyError extends Error {
  readonly reason: "compromised" | "unavailable";

  constructor(reason: "compromised" | "unavailable") {
    super(
      reason === "compromised"
        ? "This password has appeared in a data breach. Please choose a different password."
        : "Password safety check is unavailable. Please try again shortly."
    );
    this.name = "PasswordSafetyError";
    this.reason = reason;
  }
}

type PasswordRangeFetch = (
  input: URL | RequestInfo,
  init?: RequestInit
) => Promise<Response>;

// SHA-1 here is not credential storage: the HIBP k-anonymity range API
// requires the SHA-1 prefix to query breaches without revealing the password.
function sha1(password: string): string {
  return createHash("sha1").update(password).digest("hex").toUpperCase();
}

function rangeContainsHash(range: string, suffix: string): boolean {
  return range.split("\n").some((line) => {
    const [candidate, rawCount] = line.trim().split(":");
    if (candidate?.toUpperCase() !== suffix) {
      return false;
    }
    // Padded responses include fabricated entries with a count of 0.
    return Number(rawCount ?? 0) > 0;
  });
}

// Uses HIBP's k-anonymity range API. Only the first five SHA-1 characters
// leave the service; the raw password and complete password hash stay local.
export async function assertPasswordNotPwned(
  password: string,
  fetchRange: PasswordRangeFetch = fetch
): Promise<void> {
  const passwordHash = sha1(password);
  const prefix = passwordHash.slice(0, 5);
  const suffix = passwordHash.slice(5);

  let response: Response;
  try {
    response = await fetchRange(`${PWNED_PASSWORDS_API}/${prefix}`, {
      headers: {
        "Add-Padding": "true",
        "User-Agent": "asocialmedia-password-check",
      },
      signal: AbortSignal.timeout(PASSWORD_CHECK_TIMEOUT_MS),
    });
  } catch {
    recordHibpUnavailable();
    throw new PasswordSafetyError("unavailable");
  }

  if (!response.ok) {
    recordHibpUnavailable();
    throw new PasswordSafetyError("unavailable");
  }

  const range = await response.text();
  if (rangeContainsHash(range, suffix)) {
    throw new PasswordSafetyError("compromised");
  }
}
