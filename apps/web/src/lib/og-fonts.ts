import { readFileSync } from "node:fs";
import path from "node:path";

let cached:
  | {
      bold: Buffer;
      medium: Buffer;
      regular: Buffer;
    }
  | null
  | undefined;

// The Docker build runs `next build apps/web` from the monorepo root, so
// process.cwd() is "/app" there but "apps/web" locally (and the app dir when
// run from within it). Try every plausible font directory so the route builds
// and runs in both contexts.
const FONT_CANDIDATES = [
  path.join(process.cwd(), "public", "fonts"),
  path.join(process.cwd(), "apps", "web", "public", "fonts"),
  path.join(process.cwd(), "..", "apps", "web", "public", "fonts"),
];

function tryLoadFont(file: string): Buffer | null {
  for (const dir of FONT_CANDIDATES) {
    // turbopackIgnore: the fonts live in public/fonts (shipped with the app),
    // so these runtime lookups must not trigger whole-project tracing at
    // build time - tracing here once pulled every stray file in the monorepo
    // into the server bundle and broke unrelated routes.
    const candidate = path.join(/* turbopackIgnore: true */ dir, file);
    try {
      return readFileSync(/* turbopackIgnore: true */ candidate);
    } catch (error) {
      // Only ENOENT means "candidate missing, keep probing". Anything else
      // (permission, I/O) is a real failure worth surfacing.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return null;
}

function loadAllFonts(): {
  bold: Buffer;
  medium: Buffer;
  regular: Buffer;
} | null {
  if (cached !== undefined) {
    return cached;
  }

  const bold = tryLoadFont("SofiaProSoftBold.woff2");
  const medium = tryLoadFont("SofiaProSoftMed.woff2");
  const regular = tryLoadFont("SofiaProSoftReg.woff2");

  if (!bold || !medium || !regular) {
    cached = null;
    return null;
  }

  cached = { bold, medium, regular };
  return cached;
}

// Font options for Satori OG cards, or null when the woff2 files are absent
// (e.g. an image slimmed below public/fonts). Callers must degrade to the
// default sans-serif stack instead of failing the card.
export function getOgFontOptions():
  | {
      data: Buffer;
      name: string;
      style: "normal";
      weight: 400 | 500 | 700;
    }[]
  | null {
  const fonts = loadAllFonts();
  if (!fonts) {
    return null;
  }

  return [
    { data: fonts.bold, name: "SofiaProSoft", style: "normal", weight: 700 },
    { data: fonts.medium, name: "SofiaProSoft", style: "normal", weight: 500 },
    { data: fonts.regular, name: "SofiaProSoft", style: "normal", weight: 400 },
  ];
}
