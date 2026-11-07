import { expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/image", () => ({
  default: () => null,
}));

mock.module("@/components/auth/shell/auth-card", () => ({
  default: ({ mode }: { mode: string }) => (
    <form aria-label={mode}>
      <input aria-label="Email" />
    </form>
  ),
}));
const { default: AuthPage } = await import("./auth-page");

for (const mode of ["login", "signup"] as const) {
  test(`${mode} can paint before hydration while retaining the entrance fade`, () => {
    const dom = new Window();
    dom.document.body.innerHTML = renderToStaticMarkup(
      <AuthPage initialMode={mode} />
    );
    const page = dom.document.querySelector(".animate-in");
    expect(page?.classList.contains("fade-in")).toBe(true);
    expect(page?.getAttribute("style")).toBeNull();
    expect(page?.querySelector(`form[aria-label="${mode}"]`)).not.toBeNull();
    dom.close();
  });
}
