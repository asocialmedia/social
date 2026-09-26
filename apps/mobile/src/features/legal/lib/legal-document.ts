// Resolution for the in-app legal documents, free of React Native and Expo
// imports so it is unit-testable on Node.

export type LegalDocument = "privacy" | "terms";

interface LegalEntry {
  path: string;
  title: string;
}

// Points at the web app's own public routes rather than a copy, so the copy
// lives in exactly one place and a legal edit reaches the app immediately.
export const LEGAL_DOCUMENTS: Record<LegalDocument, LegalEntry> = {
  privacy: { path: "/privacy", title: "Privacy Policy" },
  terms: { path: "/toc", title: "Terms & Conditions" },
};

export const DEFAULT_LEGAL_DOCUMENT: LegalDocument = "terms";

/** Unknown or missing values fall back rather than rendering a blank screen. */
export function resolveLegalDocument(
  raw: string | string[] | undefined
): LegalDocument {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "privacy" || value === "terms"
    ? value
    : DEFAULT_LEGAL_DOCUMENT;
}

export function legalDocumentPath(document: LegalDocument): string {
  return LEGAL_DOCUMENTS[document].path;
}

export function legalDocumentTitle(document: LegalDocument): string {
  return LEGAL_DOCUMENTS[document].title;
}
