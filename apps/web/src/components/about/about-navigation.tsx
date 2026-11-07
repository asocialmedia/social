"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ActionLink } from "./about-primitives";

const sections = [
  ["#about-experience", "The idea"],
  ["#about-networks", "Open social web"],
  ["#about-principles", "Our principles"],
  ["#about-questions", "Questions"],
] as const;

export function AboutNavigation({
  onAboutPage = true,
}: {
  onAboutPage?: boolean;
}) {
  const sectionHref = (href: string) => (onAboutPage ? href : `/about${href}`);
  const [menuOpen, setMenuOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !menuOpen) {
      dialog?.close();
      return;
    }
    dialog.showModal();
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 900px)");
    const closeOnDesktop = () => {
      if (desktop.matches) {
        setMenuOpen(false);
      }
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      desktop.removeEventListener("change", closeOnDesktop);
      document.documentElement.style.overflow = previousOverflow;
      dialog.close();
    };
  }, [menuOpen]);

  useEffect(() => {
    let lastScroll = window.scrollY;
    let travel = 0;
    const onScroll = () => {
      const delta = window.scrollY - lastScroll;
      lastScroll = window.scrollY;
      if (!delta) {
        return;
      }
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (window.scrollY < 80 || travel < -24) {
        headerRef.current?.classList.remove("is-hidden");
      } else if (travel > 24 && !menuOpen) {
        headerRef.current?.classList.add("is-hidden");
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [menuOpen]);

  return (
    <header
      id="about-navigation"
      className="about-nav"
      ref={headerRef}
      onFocus={() => headerRef.current?.classList.remove("is-hidden")}
    >
      <Link className="about-nav__logo" href="/">
        asocialmedia<small>you/us</small>
      </Link>
      <ActionLink className="about-nav__cta" accent href="/">
        Come hang out
      </ActionLink>
      <nav className="about-nav__links" aria-label="About page">
        {sections.map(([href, label]) => (
          <a className="about-nav__link" href={sectionHref(href)} key={href}>
            {label}
          </a>
        ))}
      </nav>
      <button
        className="about-nav__menu square-control"
        type="button"
        aria-expanded={menuOpen}
        aria-controls="about-menu"
        onClick={() => setMenuOpen(true)}
      >
        Menu +
      </button>
      <dialog
        className="about-menu"
        id="about-menu"
        aria-label="About page navigation"
        ref={dialogRef}
        onClose={() => setMenuOpen(false)}
      >
        <div className="about-menu__top">
          <Link className="about-nav__logo" href="/">
            asocialmedia
          </Link>
          <button
            type="button"
            className="about-menu__close square-control"
            onClick={() => setMenuOpen(false)}
          >
            Close ×
          </button>
        </div>
        <nav className="about-menu__links" aria-label="Mobile about page">
          {sections.map(([href, label]) => (
            <a
              href={sectionHref(href)}
              key={href}
              onClick={() => setMenuOpen(false)}
            >
              {label}
            </a>
          ))}
          <a
            href={sectionHref("#about-build")}
            onClick={() => setMenuOpen(false)}
          >
            Build with us
          </a>
          <Link href="/" onClick={() => setMenuOpen(false)}>
            The live feed ↗
          </Link>
        </nav>
        <ActionLink className="about-menu__cta" accent href="/signup">
          Make yourself at home
        </ActionLink>
      </dialog>
    </header>
  );
}
