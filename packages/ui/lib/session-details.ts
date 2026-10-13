export interface SessionDevice {
  browser: string;
  device: string;
}

// Shared by web and native so the same recorded session has the same identity.
export function getSessionDevice(agent: string | null = null): SessionDevice {
  const value = agent ?? "";
  const native =
    /^Asocialmedia\/[^ ]+ \((?:Android|iOS|iPhone OS) [^;]*; (?<model>[^)]+)\)/.exec(
      value
    );
  if (native?.groups?.model) {
    return {
      browser: "asocialmedia app",
      device: native.groups.model.startsWith("sdk_gphone")
        ? "Android emulator"
        : native.groups.model.trim(),
    };
  }
  let browser = "Unknown browser";
  if (value.includes("T3Code")) {
    browser = "T3 Code preview";
  } else if (value.includes("HeadlessChrome/")) {
    browser = "Chrome test browser";
  } else if (value.includes("Edg/") || value.includes("EdgiOS/")) {
    browser = "Microsoft Edge";
  } else if (value.includes("Firefox/") || value.includes("FxiOS/")) {
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
    device = "Android";
  } else if (value.includes("Windows")) {
    device = "Windows";
  } else if (value.includes("Mac OS X")) {
    device = "Mac";
  } else if (value.includes("Linux")) {
    device = "Linux";
  }

  if (/^okhttp\//i.test(value)) {
    return { browser: "Android app client", device: "Android" };
  }
  return { browser, device };
}

// The joined label the sessions list shows.
export function sessionDeviceLabel(agent: string | null): string {
  const { browser, device } = getSessionDevice(agent);
  if (browser === "Android app client") {
    return browser;
  }
  if (browser === "Unknown browser") {
    return device;
  }
  if (device === "Unknown device") {
    return browser;
  }
  return `${browser} on ${device}`;
}

// Show the coarse city and country, without displaying a legacy IP address.
export function getSessionLocation(
  country: string | null,
  city: string | null
): string {
  const name = resolveCountryName(country);
  const trimmedCity = city?.trim();
  const isAddress =
    trimmedCity &&
    (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(trimmedCity) ||
      /^[\da-f]*:[\da-f:]+$/i.test(trimmedCity));
  const locationCity = trimmedCity && !isAddress ? trimmedCity : null;
  return locationCity && name
    ? `${locationCity}, ${name}`
    : locationCity || name || "Location unavailable";
}

function resolveCountryName(country: string | null): string | undefined {
  if (
    !country ||
    !/^[a-z]{2}$/i.test(country) ||
    ["XX", "ZZ"].includes(country.toUpperCase())
  ) {
    return undefined;
  }
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(
      country.toUpperCase()
    );
  } catch {
    // An unknown region throws a RangeError rather than returning undefined.
    return undefined;
  }
}

export function sessionClientLabel(agent: string | null): string {
  const native =
    /^Asocialmedia\/(?<version>[^ ]+) \((?<platform>Android|iOS|iPhone OS) [^;]*; [^)]+\)/.exec(
      agent ?? ""
    );
  if (native?.groups) {
    const platform = native.groups.platform === "Android" ? "Android" : "iOS";
    const { version } = native.groups;
    return `${platform} app${version && version !== "unknown" ? ` · v${version}` : ""}`;
  }
  if (agent?.includes("T3Code")) {
    return "Web preview";
  }
  if (agent?.includes("HeadlessChrome/")) {
    return "Web browser · automated test";
  }
  if (/^okhttp\//i.test(agent ?? "")) {
    return "App client · older version";
  }
  return getSessionDevice(agent).browser === "Unknown browser"
    ? "Client details unavailable"
    : "Web browser";
}

export function hasSessionRefresh(
  createdAt: string,
  updatedAt: string
): boolean {
  const created = Date.parse(createdAt);
  const updated = Date.parse(updatedAt);
  return (
    Number.isFinite(created) &&
    Number.isFinite(updated) &&
    updated - created >= 60_000
  );
}
