import Link from "next/link";
import type { ReactNode } from "react";

import { AboutFooter } from "@/components/about/about-closing";
import { AboutMotion } from "@/components/about/about-motion";
import { AboutNavigation } from "@/components/about/about-navigation";
import { Photo } from "@/components/about/about-primitives";

import type { DocSectionMeta } from "./doc-page";

export function EditorialLegalPage({
  children,
  crossLink,
  effectiveDate,
  sections,
  summary,
  title,
  version,
  activeId,
}: {
  children: ReactNode;
  crossLink: { href: string; label: string };
  effectiveDate: string;
  sections: readonly DocSectionMeta[];
  summary: ReactNode;
  title: string;
  version: string;
  activeId: string;
}) {
  const privacy = crossLink.href === "/toc";
  return (
    <div className="about-page" data-about-page>
      <a className="about-skip-link" href="#legal-content">
        Skip to content
      </a>
      <AboutNavigation onAboutPage={false} />
      <main id="legal-content">
        <header className="px-[var(--about-gutter)] pt-32 pb-14 sm:pt-44 sm:pb-20">
          <div className="grid items-end gap-10 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <p className="eyebrow mb-7!">Our little corner, in writing.</p>
              <h1 className="max-w-4xl text-[clamp(3.6rem,9vw,9rem)] leading-[0.9] font-medium tracking-[-0.07em]">
                {privacy ? (
                  <>
                    Your privacy.
                    <br />
                    Our promise.
                  </>
                ) : (
                  <>
                    A little trust.
                    <br />A few ground rules.
                  </>
                )}
              </h1>
              <p className="mt-8! max-w-xl text-lg leading-relaxed">
                {privacy
                  ? "A space for you should respect what belongs to you. Here’s how we handle your data, and the choices you have."
                  : "People make this place. These are the rights and responsibilities that help us look after it together."}
              </p>
              <Link
                className="text-link mt-6! inline-block"
                href={crossLink.href}
              >
                {crossLink.label} ↗
              </Link>
            </div>
            <figure className="relative">
              <Photo
                eager
                className="aspect-[4/3] overflow-hidden rounded-sm"
                photo={privacy ? "reading" : "people"}
                sizes="(max-width: 1023px) 95vw, 42vw"
              />
              <figcaption className="caption mt-3!">
                {privacy
                  ? "Room to read. Space to be yourself."
                  : "A place worth sharing. A place we care for."}
              </figcaption>
            </figure>
          </div>
        </header>
        <div className="legal-document border-t border-black/20 px-[var(--about-gutter)] py-12 lg:grid lg:grid-cols-[minmax(12rem,1fr)_minmax(0,3fr)] lg:gap-16 lg:py-20">
          <aside className="mb-12 lg:mb-0">
            <nav
              aria-label={`${title} contents`}
              className="lg:sticky lg:top-24"
            >
              <p className="eyebrow mb-5!">In this document</p>
              <ol className="grid gap-3!">
                {sections.map((section, index) => (
                  <li key={section.id}>
                    <a
                      aria-current={
                        section.id === activeId ? "location" : undefined
                      }
                      className="flex gap-3 text-sm leading-snug hover:underline aria-[current=location]:font-bold"
                      href={`#${section.id}`}
                    >
                      <span className="shrink-0 text-[#666]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span>{section.label}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
          <article className="max-w-4xl min-w-0">
            <header className="mb-8 border-b border-black/20 pb-7">
              <h2 className="text-4xl font-medium tracking-tight sm:text-5xl">
                {title}
              </h2>
              <dl className="mt-5! flex flex-wrap gap-x-8 gap-y-3 text-sm">
                <div>
                  <dt className="text-[#666]">Version</dt>
                  <dd>{version}</dd>
                </div>
                <div>
                  <dt className="text-[#666]">Effective</dt>
                  <dd>{effectiveDate}</dd>
                </div>
                <div>
                  <dt className="text-[#666]">Applies to</dt>
                  <dd>asocialmedia.cc</dd>
                </div>
              </dl>
            </header>
            <section aria-label="At a glance">{summary}</section>
            <div className="mt-14! space-y-14 [&>section]:scroll-mt-24">
              {children}
            </div>
          </article>
        </div>
      </main>
      <AboutFooter />
      <AboutMotion />
    </div>
  );
}
