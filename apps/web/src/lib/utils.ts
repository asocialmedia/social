import { clientLog } from "@asm/config/debug";
import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { formatDate } from "date-fns";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeDate(from: Date | string) {
  try {
    const dateObj = typeof from === "string" ? new Date(from) : from;
    if (Number.isNaN(dateObj.getTime())) {
      clientLog.error("Invalid date:", from);
      return "Invalid date";
    }

    const currentDate = new Date();
    const diffMs = currentDate.getTime() - dateObj.getTime();
    if (diffMs < 24 * 60 * 60 * 1000) {
      const diffMinutes = Math.max(0, Math.floor(diffMs / (60 * 1000)));
      if (diffMinutes < 1) {
        return "just now";
      }
      if (diffMinutes < 60) {
        return `${diffMinutes}m`;
      }
      return `${Math.floor(diffMinutes / 60)}h`;
    }
    if (currentDate.getFullYear() === dateObj.getFullYear()) {
      return formatDate(dateObj, "MMM d");
    }
    return formatDate(dateObj, "MMM d, yyyy");
  } catch (error) {
    clientLog.error("Error formatting date:", error, "Input was:", from);
    return "Invalid date";
  }
}

export function formatSearchTime(date?: Date | string | number | null): string {
  if (!date) {
    return "";
  }
  try {
    const dateObj =
      typeof date === "number" || typeof date === "string"
        ? new Date(date)
        : date;
    if (Number.isNaN(dateObj.getTime())) {
      return "";
    }

    const currentDate = new Date();
    const diffMs = currentDate.getTime() - dateObj.getTime();
    if (diffMs < 60 * 1000) {
      return "searched just now";
    }
    const diffMinutes = Math.floor(diffMs / (60 * 1000));
    if (diffMinutes < 60) {
      return `searched ${diffMinutes}m ago`;
    }
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return `searched ${diffHours}h ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) {
      return `searched ${diffDays}d ago`;
    }
    if (currentDate.getFullYear() === dateObj.getFullYear()) {
      return `searched on ${formatDate(dateObj, "MMM d")}`;
    }
    return `searched on ${formatDate(dateObj, "MMM d, yyyy")}`;
  } catch {
    return "";
  }
}

export function formatNumber(num: number): string {
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  if (abs >= 1_000_000) {
    return `${sign}${trimTrailingZero((abs / 1_000_000).toFixed(1))}m`;
  }
  if (abs >= 1000) {
    return `${sign}${trimTrailingZero((abs / 1000).toFixed(1))}k`;
  }
  return `${sign}${abs}`;
}

function trimTrailingZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replaceAll(" ", "-")
    .replaceAll(/[^a-z0-9-]/g, "");
}

const TRANSPARENT_IMAGE_EXTENSION =
  /\.(?<extension>png|webp|gif|svg|avif)(?<query>\?|$)/i;

export function supportsTransparency(url?: string | null): boolean {
  if (!url) {
    return false;
  }
  return TRANSPARENT_IMAGE_EXTENSION.test(url);
}

const GIF_EXTENSION = /\.gif(?<query>\?.*)?(?<hash>#.*)?$/i;

export function isGifUrl(url?: string | null): boolean {
  if (!url) {
    return false;
  }
  return GIF_EXTENSION.test(url);
}

export function isRouteActive(currentHref: string, itemHref: string): boolean {
  if (itemHref === "/") {
    return currentHref === "/" || currentHref.startsWith("/?");
  }
  const [currentPath, currentQueryStr = ""] = currentHref.split("?");
  const [itemPath, itemQueryStr = ""] = itemHref.split("?");
  const pathMatches =
    currentPath === itemPath ||
    currentPath.startsWith(itemPath === "/" ? "/" : `${itemPath}/`);
  if (!pathMatches) {
    return false;
  }
  const currentQuery = new URLSearchParams(currentQueryStr);
  const itemQuery = new URLSearchParams(itemQueryStr);
  for (const [key, value] of itemQuery) {
    if (currentQuery.get(key) !== value) {
      return false;
    }
  }
  return true;
}
