import { expect, test } from "bun:test";

import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";

import PrivacyPolicyPage from "@/app/(docs)/privacy/client-privacy";
import TermsPage from "@/app/(docs)/toc/client-toc";

for (const [name, Page, sectionCount] of [
  ["privacy", PrivacyPolicyPage, 13],
  ["terms", TermsPage, 14],
] as const) {
  test(`${name} keeps every legal paragraph and working section link in the About shell`, () => {
    const dom = new Window();
    const { document } = dom;
    document.body.innerHTML = renderToStaticMarkup(<Page />);
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(document.querySelectorAll("article > div > section")).toHaveLength(
      sectionCount
    );
    expect(document.querySelector(".tinted-photo img")).not.toBeNull();
    expect(document.querySelector(".footer-base")?.textContent).toContain(
      "Design via Singularity Works"
    );
    expect(
      document.querySelector('.about-nav__link[href="/about#about-experience"]')
    ).not.toBeNull();
    for (const link of document.querySelectorAll('a[href^="#"]')) {
      expect(
        document.querySelector(link.getAttribute("href") ?? "#missing")
      ).not.toBeNull();
    }
    const paragraphs = [...document.querySelectorAll(".doc-body")].map(
      (element) => element.textContent
    );
    document.body.innerHTML = renderToStaticMarkup(<Page embedded />);
    expect(
      [...document.querySelectorAll(".doc-body")].map(
        (element) => element.textContent
      )
    ).toEqual(paragraphs);
    expect(document.querySelector("#about-footer")).toBeNull();
    dom.close();
  });
}
