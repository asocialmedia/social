"use client";

import { ArrowLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import ScrollUpButton from "@/components/layouts/scroll-up-button";
import { cn } from "@/lib/utils";

// Shared shell for the two legal documents (Privacy Policy, Terms of Service).
//
// They are long reference documents, so the layout is a document: a contents
// rail that tracks your position, a reading column at a sane measure, and
// numbered sections whose number is real structure rather than decoration. The
// app's raised surfaces carry the chrome; the document itself is plain, legible
// type on the page surface.
//
// Both pages render through this so the frame can never drift between them.
// The section list is the single source of truth for both the rail and the
// section numbers: DocSection looks its own number up by id, so adding,
// removing or reordering a section keeps the two in step automatically.

export interface DocSectionMeta {
  id: string;
  label: string;
}

const SectionIndexContext = createContext<readonly DocSectionMeta[]>([]);

// Tracks which section is currently under the reading position. A thin band
// near the top of the viewport decides: whichever section intersects it wins.
// This only marks the contents rail - it never gates content, so a browser
// without IntersectionObserver still renders the full document.
function useActiveSection(sections: readonly DocSectionMeta[]): string {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const targets = sections
      // Ids are internal constants (lowercase slugs), so the attribute selector
      // needs no escaping.
      .map((section) => document.querySelector<HTMLElement>(`#${section.id}`))
      .filter((element): element is HTMLElement => element !== null);
    if (targets.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const inBand = entries
          .filter((entry) => entry.isIntersecting)
          .toSorted(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top
          );
        const first = inBand[0]?.target.id;
        if (first) {
          setActiveId(first);
        }
      },
      // A band from just under the top edge to two-thirds down: a section is
      // "current" once its heading reaches reading height, and stops being
      // current when it scrolls up out of the band.
      { rootMargin: "-88px 0px -66% 0px", threshold: 0 }
    );

    for (const target of targets) {
      observer.observe(target);
    }
    return () => observer.disconnect();
  }, [sections]);

  return activeId;
}

function useScrolled(threshold = 400): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [threshold]);
  return scrolled;
}

function ordinal(index: number): string {
  return String(index + 1).padStart(2, "0");
}

// One contents entry. The active state is carried by tone and weight - a
// surface shift plus full-strength text - rather than a dot or a sliding
// underline, so it reads as the current page of a document.
function ContentsEntry({
  active,
  index,
  section,
}: {
  active: boolean;
  index: number;
  section: DocSectionMeta;
}) {
  return (
    <li>
      <a
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex items-baseline gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors duration-150",
          active
            ? "bg-muted text-foreground font-semibold"
            : "text-muted-foreground hover:text-foreground"
        )}
        href={`#${section.id}`}
      >
        <span className="text-[11px] font-semibold tabular-nums opacity-55">
          {ordinal(index)}
        </span>
        <span className="min-w-0 text-pretty">{section.label}</span>
      </a>
    </li>
  );
}

export function DocPage({
  children,
  crossLink,
  effectiveDate,
  sections,
  summary,
  title,
  version,
}: {
  children: React.ReactNode;
  crossLink: { href: string; label: string };
  effectiveDate: string;
  sections: readonly DocSectionMeta[];
  summary: React.ReactNode;
  title: string;
  version: string;
}) {
  const activeId = useActiveSection(sections);
  const scrolled = useScrolled();
  const sectionList = useMemo(() => sections, [sections]);

  return (
    <SectionIndexContext.Provider value={sectionList}>
      <div className="min-h-screen w-full">
        <div className="mx-auto w-full max-w-6xl px-5 pt-6 pb-24 sm:px-8">
          {/* Slim chrome: leave the document, or cross to the other one. Both
              are plain links, so nothing here competes with the document. */}
          <nav className="flex items-center justify-between gap-4">
            <Link
              className="text-muted-foreground hover:text-foreground group inline-flex items-center gap-2 text-sm font-medium transition-colors"
              href="/"
            >
              <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
              Back to feed
            </Link>
            <Link
              className="text-muted-foreground hover:text-foreground group inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
              href={crossLink.href}
            >
              {crossLink.label}
              <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </nav>

          <div className="mt-10 lg:grid lg:grid-cols-[14.5rem_minmax(0,1fr)] lg:gap-14 xl:gap-16">
            {/* Contents. A sticky rail beside the document on wide screens, and
                a native disclosure above it on narrow ones, where a rail would
                eat the reading width. */}
            <div className="mb-10 lg:mb-0">
              <details className="panel-3d group rounded-2xl p-3 lg:hidden">
                <summary className="text-foreground cursor-pointer list-none px-1 py-1 text-sm font-semibold select-none">
                  Contents
                  <span className="text-muted-foreground ml-2 text-xs font-normal">
                    {sections.length} sections
                  </span>
                </summary>
                <ul className="mt-2 flex flex-col gap-0.5">
                  {sections.map((section, index) => (
                    <ContentsEntry
                      active={section.id === activeId}
                      index={index}
                      key={section.id}
                      section={section}
                    />
                  ))}
                </ul>
              </details>

              <nav
                aria-label={`${title} contents`}
                className="panel-3d sticky top-6 hidden rounded-2xl p-3 lg:block"
              >
                <p className="text-muted-foreground px-2.5 pt-1 pb-2 text-xs font-semibold">
                  Contents
                </p>
                <ul className="flex max-h-[min(34rem,70vh)] flex-col gap-0.5 overflow-y-auto">
                  {sections.map((section, index) => (
                    <ContentsEntry
                      active={section.id === activeId}
                      index={index}
                      key={section.id}
                      section={section}
                    />
                  ))}
                </ul>
              </nav>
            </div>

            {/* The document. */}
            <main className="min-w-0">
              <header className="border-border/60 border-b pb-7">
                <h1 className="text-foreground text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">
                  {title}
                </h1>
                {/* Document metadata as a real description list, not chips. */}
                <dl className="text-muted-foreground mt-4 flex flex-wrap gap-x-7 gap-y-2 text-xs">
                  <div className="flex items-baseline gap-1.5">
                    <dt className="opacity-70">Version</dt>
                    <dd className="text-foreground font-semibold">{version}</dd>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <dt className="opacity-70">Effective</dt>
                    <dd className="text-foreground font-semibold">
                      {effectiveDate}
                    </dd>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <dt className="opacity-70">Applies to</dt>
                    <dd className="text-foreground font-semibold">
                      asocialmedia.cc
                    </dd>
                  </div>
                </dl>
              </header>

              {/* Plain-language commitments, set as a definition list. The
                  document's own words carry this - no icon tiles, no badges. */}
              <section className="mt-8">{summary}</section>

              <div className="mt-12 space-y-14">{children}</div>
            </main>
          </div>
        </div>

        <ScrollUpButton isVisible={scrolled} />
      </div>
    </SectionIndexContext.Provider>
  );
}

// A numbered section. The number is looked up from the shared section list by
// id, so the heading and the contents rail cannot disagree.
export function DocSection({
  children,
  id,
  title,
}: {
  children: React.ReactNode;
  id: string;
  title: string;
}) {
  const sections = useContext(SectionIndexContext);
  const index = sections.findIndex((section) => section.id === id);
  // A positively-named flag, so the JSX reads as "numbered ? show : omit" with
  // no negated condition.
  const isNumbered = index !== -1;

  return (
    <section className="scroll-mt-8" id={id}>
      <header className="mb-3.5 flex items-baseline gap-3.5">
        {isNumbered ? (
          <span className="text-primary/45 text-xl font-bold tabular-nums sm:text-2xl">
            {ordinal(index)}
          </span>
        ) : null}
        <h2 className="text-foreground text-xl font-bold tracking-tight text-balance sm:text-2xl">
          {title}
        </h2>
      </header>
      <div className="doc-body">{children}</div>
    </section>
  );
}

// A raised aside for the statements that carry more weight than the running
// text - the "we never do this" commitments, the liability limits. A tonal
// surface with a real heading, rather than an accent bar or an icon tile.
export function DocNote({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <aside className="surface-3d mt-5 rounded-2xl p-5">
      <p className="text-foreground text-sm font-semibold">{title}</p>
      <div className="doc-body doc-body-tight mt-2">{children}</div>
    </aside>
  );
}

// A reference table (cookie keys, response windows). Key names are genuinely
// data, so they get the monospace treatment; nothing else does.
export function DocTable({
  children,
  head,
}: {
  children: React.ReactNode;
  head: readonly string[];
}) {
  return (
    <div className="panel-3d mt-5 overflow-x-auto rounded-2xl p-1.5">
      <table className="w-full min-w-[38rem] border-collapse text-left text-sm">
        <thead>
          <tr>
            {head.map((label) => (
              <th
                className="text-muted-foreground px-3 py-2.5 text-xs font-semibold"
                key={label}
                scope="col"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-border/40 [&_td]:border-t [&_td]:px-3 [&_td]:py-3 [&_td]:align-top">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function DocKey({ children }: { children: React.ReactNode }) {
  return (
    <code className="text-foreground font-mono text-xs font-semibold">
      {children}
    </code>
  );
}
