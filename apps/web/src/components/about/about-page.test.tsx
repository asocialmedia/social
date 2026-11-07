import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";

import AboutPage, { metadata } from "../../app/(docs)/about/page";
import { aboutPhotos, aboutQuestions } from "./about-content";

function renderPage() {
  const dom = new Window();
  dom.document.body.innerHTML = renderToStaticMarkup(<AboutPage />);
  return dom.document;
}

test("the complete About story and FAQ are readable before JavaScript runs", () => {
  const document = renderPage();
  expect(document.querySelectorAll("h1")).toHaveLength(1);
  expect(document.querySelectorAll("main")).toHaveLength(1);
  expect(document.querySelectorAll("main > section")).toHaveLength(10);
  expect(document.querySelectorAll("details")).toHaveLength(
    aboutQuestions.length
  );
  const structuredData = JSON.parse(
    document.querySelector('script[type="application/ld+json"]')?.textContent ??
      "{}"
  );
  expect(structuredData.mainEntity).toHaveLength(aboutQuestions.length);
  for (const [index, entry] of aboutQuestions.entries()) {
    const detail = document.querySelectorAll("details")[index];
    expect(detail?.querySelector("summary")?.textContent).toContain(
      entry.question
    );
    expect(detail?.querySelector("p")?.textContent).toBe(entry.answer);
    expect(structuredData.mainEntity[index].acceptedAnswer.text).toBe(
      entry.answer
    );
  }
});

test("navigation anchors resolve and the template has no demo forms or fictional endorsements", () => {
  const document = renderPage();
  const ids = [...document.querySelectorAll("[id]")].map(
    (element) => element.id
  );
  expect(new Set(ids).size).toBe(ids.length);
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    expect(
      document.querySelector(link.getAttribute("href") ?? "#missing")
    ).not.toBeNull();
  }
  expect(document.querySelector("form")).toBeNull();
  expect(document.querySelector("blockquote")).toBeNull();
  expect(
    document.querySelectorAll(".feature-photo > .tinted-photo__image")
  ).toHaveLength(3);
  expect(document.body.innerHTML).not.toMatch(
    /Tallyhouse|data-8b|bookkeeping|Self Assessment|HMRC|£/i
  );
  expect(
    document.querySelector('dialog[aria-label="About page navigation"]')
  ).not.toBeNull();
});

test("network plans are distinguished from shipped discovery and all visual assets are local", () => {
  const document = renderPage();
  const copy = document.body.textContent;
  expect(copy).toContain("Public Bluesky discovery is available");
  expect(copy).toContain(
    "Full federation, posting back to other networks and ActivityPub support are still being built toward"
  );
  expect(copy).toContain("companion experience is work in progress");
  expect(copy).toContain(
    "No ads, no selling personal data and no paid shortcuts"
  );
  for (const image of document.querySelectorAll("img")) {
    expect(image.getAttribute("alt")?.length).toBeGreaterThan(5);
    expect(image.getAttribute("src")).not.toMatch(/^https?:/);
  }
  for (const image of Object.values(aboutPhotos)) {
    expect(
      existsSync(
        path.resolve(import.meta.dir, "../../../public", image.src.slice(1))
      )
    ).toBe(true);
  }
});

test("footer credits and search metadata describe the About page and its custom sharing image", async () => {
  const document = renderPage();
  expect(document.querySelector(".footer-base")?.textContent).toContain(
    "Design via Singularity Works"
  );
  expect(document.querySelector(".footer-base")?.textContent).not.toContain(
    "8B"
  );
  expect(
    document.querySelector('.footer-base a[href="https://przknv.cc"]')
  ).not.toBeNull();
  expect(metadata).toMatchObject({
    alternates: { canonical: "/about" },
    openGraph: {
      images: [{ height: 630, url: "/about/share.png", width: 1200 }],
      url: "https://asocialmedia.cc/about",
    },
    twitter: {
      card: "summary_large_image",
      images: [{ url: "/about/share.png" }],
    },
  });
  const schemas = [
    ...document.querySelectorAll('script[type="application/ld+json"]'),
  ].map((script) => JSON.parse(script.textContent));
  expect(schemas.map((schema) => schema["@type"])).toEqual([
    "FAQPage",
    "AboutPage",
    "BreadcrumbList",
  ]);
  const share = await sharp(
    path.resolve(import.meta.dir, "../../../public/about/share.png")
  ).metadata();
  expect(share).toMatchObject({ format: "png", height: 630, width: 1200 });
  for (const image of Object.values(aboutPhotos)) {
    expect(image.src).toMatch(/^\/about\/artwork\/.*\.webp$/);
  }
});
