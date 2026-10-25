import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ZephLoader } from "./zeph-loader";

describe("Zeph loading feedback", () => {
  test.each(["general", "messages", "search", "media", "security"] as const)(
    "renders the %s illustration with an accessible status",
    (variant) => {
      const html = renderToStaticMarkup(
        <ZephLoader label="Preparing your view" size={96} variant={variant} />
      );
      expect(html).toContain('<output aria-label="Preparing your view"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain("height:96px");
      expect(html).toContain("width:96px");
      expect(html).toContain("motion-reduce:animate-none");
      expect(html).not.toContain("animate-spin");
      expect(html).toContain(
        variant === "general"
          ? "zeph-loading-waiting"
          : `zeph-loading-${variant}`
      );
    }
  );
  test("preserves caller layout and decorative semantics for inline loading", () => {
    const html = renderToStaticMarkup(
      <ZephLoader aria-hidden className="size-4" variant="search" />
    );
    expect(html).toContain("size-4");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("height:96px");
  });
});
