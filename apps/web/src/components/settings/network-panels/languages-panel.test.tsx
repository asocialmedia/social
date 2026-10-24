import { expect, mock, test } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";
import { Window } from "happy-dom";
import type { ReactNode } from "react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import LanguagesPanel from "./languages-panel";

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

test("LanguagesPanel displays selected content languages and button to open dialog", () => {
  const preferences = {
    ...defaultNetworkPreferences(),
    contentLanguages: ["en", "ja"],
  };
  const profile = preferences.profiles[0] ?? {
    id: "default",
    interests: [],
    name: "Everyday",
  };

  const html = renderToStaticMarkup(
    <LanguagesPanel
      catalog={[]}
      isSaving={false}
      persona={{
        avoidedTopics: [],
        learnedInterests: [],
        relatedInterests: [],
        signalCount: 0,
      }}
      preferences={preferences}
      profile={profile}
      save={() => {}}
    />
  );

  const window = new Window();
  window.document.body.innerHTML = html;

  expect(html).toContain("Geography and language");
  expect(html).toContain("Content languages");
  expect(html).toContain("Select content languages");
  expect(html).toContain("2 selected");
  expect(html).toContain("English");
  expect(html).toContain("Japanese");
  expect(html).toContain("Regional content");

  window.close();
});

test("LanguagesPanel displays all languages fallback when none are selected", () => {
  const preferences = {
    ...defaultNetworkPreferences(),
    contentLanguages: [],
  };
  const profile = preferences.profiles[0] ?? {
    id: "default",
    interests: [],
    name: "Everyday",
  };

  const html = renderToStaticMarkup(
    <LanguagesPanel
      catalog={[]}
      isSaving={false}
      persona={{
        avoidedTopics: [],
        learnedInterests: [],
        relatedInterests: [],
        signalCount: 0,
      }}
      preferences={preferences}
      profile={profile}
      save={() => {}}
    />
  );

  expect(html).toContain("All languages (none selected)");
  expect(html).toContain("All languages are currently shown in your feeds.");
});
