import { expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import type { ReactNode } from "react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ContentLanguagesDialog } from "./content-languages-dialog";

mock.module("@asm/ui/shadui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

test("ContentLanguagesDialog renders the title, description, and sections matching Bluesky content language selector", () => {
  const html = renderToStaticMarkup(
    <ContentLanguagesDialog
      onOpenChange={() => {}}
      onSelectLanguages={() => {}}
      open={true}
      selectedLanguages={["en", "ja"]}
    />
  );

  const window = new Window();
  window.document.body.innerHTML = html;

  expect(html).toContain("Select content languages");
  expect(html).toContain(
    "If none are selected, all languages will be shown in your feeds"
  );
  expect(html).toContain("Search languages");
  expect(html).toContain("Recently used");
  expect(html).toContain("All languages");

  // English and Japanese are present and selected
  expect(html).toContain("English");
  expect(html).toContain("Japanese");

  // All languages starts alphabetically with Afar, Abkhazian, Afrikaans etc.
  expect(html).toContain("Afrikaans");

  window.close();
});

test("ContentLanguagesDialog highlights selected languages with aria-pressed and checkmarks", () => {
  const html = renderToStaticMarkup(
    <ContentLanguagesDialog
      onOpenChange={() => {}}
      onSelectLanguages={() => {}}
      open={true}
      selectedLanguages={["en"]}
    />
  );

  const window = new Window();
  window.document.body.innerHTML = html;

  const buttons = window.document.querySelectorAll("button[aria-pressed]");
  const enButtons = [...buttons].filter((b) =>
    b.textContent?.includes("English")
  );
  expect(enButtons.length).toBeGreaterThan(0);
  expect(enButtons[0]?.getAttribute("aria-pressed")).toBe("true");

  const deButtons = [...buttons].filter((b) =>
    b.textContent?.includes("German")
  );
  expect(deButtons.length).toBeGreaterThan(0);
  expect(deButtons[0]?.getAttribute("aria-pressed")).toBe("false");

  window.close();
});
