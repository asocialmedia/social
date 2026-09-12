export interface SecuritySession {
  country: string | null;
  createdAt: string;
  expiresAt: string;
  id: string;
  ipAddress: string | null;
  token: string;
  updatedAt: string;
  userAgent: string | null;
}

export function isSecuritySession(value: unknown): value is SecuritySession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const session = value as Record<string, unknown>;
  return (
    typeof session.id === "string" &&
    typeof session.token === "string" &&
    typeof session.createdAt === "string" &&
    typeof session.updatedAt === "string" &&
    typeof session.expiresAt === "string" &&
    (typeof session.country === "string" ||
      session.country === null ||
      session.country === undefined) &&
    (typeof session.ipAddress === "string" ||
      session.ipAddress === null ||
      session.ipAddress === undefined) &&
    (typeof session.userAgent === "string" ||
      session.userAgent === null ||
      session.userAgent === undefined)
  );
}

export function getSessionDevice(agent: string | null): {
  browser: string;
  device: string;
} {
  const userAgentString = agent === null ? "" : agent;
  let browser = "Unknown browser";
  if (userAgentString.includes("Edg/")) {
    browser = "Microsoft Edge";
  } else if (userAgentString.includes("Firefox/")) {
    browser = "Firefox";
  } else if (
    userAgentString.includes("Chrome/") ||
    userAgentString.includes("CriOS/")
  ) {
    browser = "Chrome";
  } else if (userAgentString.includes("Safari/")) {
    browser = "Safari";
  }

  let device = "Unknown device";
  if (userAgentString.includes("iPhone")) {
    device = "iPhone";
  } else if (userAgentString.includes("iPad")) {
    device = "iPad";
  } else if (userAgentString.includes("Android")) {
    device = "Android device";
  } else if (userAgentString.includes("Windows")) {
    device = "Windows";
  } else if (userAgentString.includes("Mac OS X")) {
    device = "Mac";
  } else if (userAgentString.includes("Linux")) {
    device = "Linux device";
  }

  return { browser, device };
}

export function getSessionLocation(
  country: string | null,
  ipAddress: string | null
): string {
  const countryName = country
    ? new Intl.DisplayNames(["en"], { type: "region" }).of(country)
    : undefined;
  if (countryName && ipAddress) {
    return `${countryName} · ${ipAddress}`;
  }
  return countryName || ipAddress || "Location unavailable";
}
