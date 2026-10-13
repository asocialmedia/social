// Browser-safe session presentation shared with the web settings page.
export {
  getSessionDevice,
  getSessionLocation,
  hasSessionRefresh,
  sessionClientLabel,
  sessionDeviceLabel,
} from "@asm/ui/lib/session-details";

export interface SecuritySession {
  city?: string | null;
  country: string | null;
  createdAt: string;
  current: boolean;
  expiresAt: string | null;
  id: string;
  ipAddress: string | null;
  updatedAt: string;
  userAgent: string | null;
}

// "Last active", matching the phrasing the sessions card uses.
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
