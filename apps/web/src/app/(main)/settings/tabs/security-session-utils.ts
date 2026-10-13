export {
  getSessionDevice,
  getSessionLocation,
  hasSessionRefresh,
  sessionClientLabel,
  sessionDeviceLabel,
} from "@asm/ui/lib/session-details";

export interface SecuritySession {
  city?: string | null;
  current?: boolean;
  country: string | null;
  createdAt: string;
  expiresAt: string;
  id: string;
  ipAddress: string | null;
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
    typeof session.createdAt === "string" &&
    typeof session.updatedAt === "string" &&
    typeof session.expiresAt === "string" &&
    (session.current === undefined || typeof session.current === "boolean") &&
    (session.city === undefined ||
      session.city === null ||
      typeof session.city === "string") &&
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
