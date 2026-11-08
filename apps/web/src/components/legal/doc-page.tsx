"use client";

import type React from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { EditorialLegalPage } from "./editorial-legal-page";

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

function ordinal(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export function DocPage({
  children,
  crossLink,
  effectiveDate,
  embedded = false,
  sections,
  summary,
  title,
  version,
}: {
  children: React.ReactNode;
  crossLink: { href: string; label: string };
  effectiveDate: string;
  embedded?: boolean;
  sections: readonly DocSectionMeta[];
  summary: React.ReactNode;
  title: string;
  version: string;
}) {
  const activeId = useActiveSection(sections);
  const sectionList = useMemo(() => sections, [sections]);
  return (
    <SectionIndexContext.Provider value={sectionList}>
      {embedded ? (
        <article className="mx-auto w-full px-5 py-6 sm:px-8">
          <header className="border-border/60 border-b pb-7">
            <h1 className="text-foreground text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
              {title}
            </h1>
            <dl className="text-muted-foreground mt-4 flex flex-wrap gap-x-7 gap-y-2 text-xs">
              <div>
                <dt>Version</dt>
                <dd>{version}</dd>
              </div>
              <div>
                <dt>Effective</dt>
                <dd>{effectiveDate}</dd>
              </div>
              <div>
                <dt>Applies to</dt>
                <dd>asocialmedia.cc</dd>
              </div>
            </dl>
          </header>
          <section className="mt-8">{summary}</section>
          <div className="mt-12 space-y-14">{children}</div>
        </article>
      ) : (
        <EditorialLegalPage
          activeId={activeId}
          crossLink={crossLink}
          effectiveDate={effectiveDate}
          sections={sections}
          summary={summary}
          title={title}
          version={version}
        >
          {children}
        </EditorialLegalPage>
      )}
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
          <span className="text-primary/80 text-xl font-bold tabular-nums sm:text-2xl">
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
