import { isIP } from "node:net";

export function normalizeSessionAddress(
  value: string | null | undefined
): string | null {
  const address = value?.trim();
  if (!address || !isIP(address) || address === "0.0.0.0") {
    return null;
  }
  if (isIP(address) === 6) {
    try {
      const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
      return canonical === "::" ? null : canonical;
    } catch {
      return null;
    }
  }
  return address;
}

export function sessionMetadata(
  session: { ipAddress?: string | null; userAgent?: string | null },
  headers?: Headers
) {
  const agent = headers?.get("user-agent");
  const native =
    headers?.get("x-asm-client") === "mobile" &&
    agent &&
    agent.length <= 256 &&
    /^Asocialmedia\/[^ ]+ \((?:Android|iOS|iPhone OS) [^;]*; [^)]+\)$/.test(
      agent
    );
  const country = headers?.get("cf-ipcountry")?.trim().toUpperCase();
  return {
    ...(country && /^[A-Z]{2}$/.test(country) && !["XX", "ZZ"].includes(country)
      ? { country }
      : {}),
    ipAddress: normalizeSessionAddress(session.ipAddress),
    userAgent: native ? agent : (session.userAgent ?? null),
  };
}
