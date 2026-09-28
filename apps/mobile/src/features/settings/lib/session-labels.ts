// Session labels, a faithful port of web's
// `settings/tabs/security-session-utils.ts`. Pure, so the parsing is testable
// without a renderer or a network.

export interface SecuritySession {
  country: string | null;
  createdAt: string;
  current: boolean;
  expiresAt: string | null;
  id: string;
  ipAddress: string | null;
  updatedAt: string;
  userAgent: string | null;
}

export interface SessionDevice {
  browser: string;
  device: string;
}

/**
 * Web's `getSessionDevice`. The browser and the device are reported separately
 * rather than joined here, because the sessions list shows them as one label
 * while other surfaces use them apart.
 */
export function getSessionDevice(agent: string | null = null): SessionDevice {
  const value = agent ?? "";
  let browser = "Unknown browser";
  if (value.includes("Edg/")) {
    browser = "Microsoft Edge";
  } else if (value.includes("Firefox/")) {
    browser = "Firefox";
  } else if (value.includes("Chrome/") || value.includes("CriOS/")) {
    browser = "Chrome";
  } else if (value.includes("Safari/")) {
    browser = "Safari";
  }

  let device = "Unknown device";
  if (value.includes("iPhone")) {
    device = "iPhone";
  } else if (value.includes("iPad")) {
    device = "iPad";
  } else if (value.includes("Android")) {
    device = "Android device";
  } else if (value.includes("Windows")) {
    device = "Windows";
  } else if (value.includes("Mac OS X")) {
    device = "Mac";
  } else if (value.includes("Linux")) {
    device = "Linux device";
  }

  return { browser, device };
}

/** The joined label the sessions list shows. */
export function sessionDeviceLabel(agent: string | null): string {
  const { browser, device } = getSessionDevice(agent);
  if (browser === "Unknown browser") {
    return device;
  }
  if (device === "Unknown device") {
    return browser;
  }
  return `${browser} on ${device}`;
}

/**
 * Web's `getSessionLocation`: the country name plus the address, degrading to
 * whichever half is present and then to an honest "unavailable" rather than
 * printing "null" or an empty row.
 */
export function getSessionLocation(
  country: string | null,
  ipAddress: string | null
): string {
  const name = resolveCountryName(country);
  if (name && ipAddress) {
    return `${name} · ${ipAddress}`;
  }
  return name || ipAddress || "Location unavailable";
}

function resolveCountryName(country: string | null): string | undefined {
  if (!country) {
    return undefined;
  }
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(country);
  } catch {
    // An unknown region throws a RangeError rather than returning undefined.
    return undefined;
  }
}

/** "Last active", matching the phrasing the sessions card uses. */
export function formatLastActive(iso: string | null, now: number): string {
  if (!iso) {
    return "unknown";
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "unknown";
  }
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return new Date(iso).toLocaleDateString();
}
