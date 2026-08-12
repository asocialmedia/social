import { type ClassValue, clsx } from "clsx";
import { formatDate } from "date-fns";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeDate(from: Date | string) {
  try {
    const dateObj = typeof from === "string" ? new Date(from) : from;
    if (Number.isNaN(dateObj.getTime())) {
      console.error("Invalid date:", from);
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
  } catch (e) {
    console.error("Error formatting date:", e, "Input was:", from);
    return "Invalid date";
  }
}

export function formatNumber(num: number): string {
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1000) {
    return `${sign}${(abs / 1000).toFixed(1)}K`;
  }
  return `${sign}${abs}`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ /g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

const TRANSPARENT_IMAGE_EXTENSION = /\.(png|webp|gif|svg|avif)(\?|$)/i;

export function supportsTransparency(url?: string | null): boolean {
  if (!url) {
    return false;
  }
  return TRANSPARENT_IMAGE_EXTENSION.test(url);
}

const GIF_EXTENSION = /\.gif(\?.*)?(#.*)?$/i;

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
