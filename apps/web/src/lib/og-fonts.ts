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

function tryLoadFont(file: string): Buffer | null {
  const candidates = [
    path.join(process.cwd(), "public", "fonts"),
    path.join(process.cwd(), "apps", "web", "public", "fonts"),
    path.join(process.cwd(), "..", "apps", "web", "public", "fonts"),
  ];

  for (const dir of candidates) {
    const candidate = path.join(dir, file);
    try {
      // Do not let Turbopack trace public/fonts at build time.
      return readFileSync(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // Real I/O error — surface it; only ENOENT means “try the next dir”.
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
