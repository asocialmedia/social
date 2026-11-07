"use client";

import { useEffect } from "react";

function setVariables(
  element: HTMLElement | null,
  variables: Record<string, string>
) {
  if (!element) {
    return;
  }
  for (const [name, value] of Object.entries(variables)) {
    element.style.setProperty(name, value);
  }
}

function layoutBox(element: HTMLElement) {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;
  while (node) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
  }
  return { height: element.offsetHeight, width: element.offsetWidth, x, y };
}

export function initialiseAboutMotion(page: HTMLElement) {
  const preference = window.matchMedia(
    "(prefers-reduced-motion: no-preference)"
  );
  let frame = 0;
  let disposed = false;
  const select = (selector: string) =>
    page.querySelector<HTMLElement>(selector);
  const selectAll = (selector: string) => [
    ...page.querySelectorAll<HTMLElement>(selector),
  ];
  const stage = select(".hero-stage");
  const cover = select(".hero-cover");
  const sheet = select(".field-guide");
  const parts = selectAll(".field-guide-section");
  const notes = selectAll(".experience-note");
  const keys = selectAll(".experience-key");
  const band = select(".field-guide-highlight");
  const networkView = select(".network-view");
  const networkTrack = select(".network-track");
  const networkSection = select("#about-networks");
  const revealElements = selectAll("[data-reveal]");

  const updateScroll = () => {
    frame = 0;
    if (page.dataset.motionEnabled === undefined) {
      return;
    }
    for (const element of revealElements) {
      if (element.getBoundingClientRect().top < window.innerHeight * 0.9) {
        element.classList.add("is-in");
      }
    }
    const steps = window.innerWidth >= 900 ? notes : parts;
    let activeIndex = -1;
    for (const [index, step] of steps.entries()) {
      if (step.getBoundingClientRect().top < window.innerHeight * 0.58) {
        activeIndex = index;
      }
    }
    const part = parts[activeIndex];
    for (const [index, key] of keys.entries()) {
      key.classList.toggle("is-on", index === activeIndex);
    }
    sheet?.toggleAttribute("data-lit", Boolean(part));
    sheet?.toggleAttribute("data-cash", activeIndex >= 1);
    if (part) {
      setVariables(band, {
        "--about-field-guide-highlight-s": `${(part.offsetHeight + 12) / 100}`,
        "--about-field-guide-highlight-y": `${part.offsetTop - 6}px`,
      });
    }
  };
  const queueScroll = () => {
    if (!frame) {
      frame = requestAnimationFrame(updateScroll);
    }
  };

  const measure = () => {
    if (disposed || page.dataset.motionEnabled === undefined) {
      return;
    }
    if (stage && cover) {
      const stageBox = layoutBox(stage);
      const coverBox = layoutBox(cover);
      setVariables(select(".hero-signature"), {
        "--about-hero-signature-x": `${stageBox.x + stageBox.width - coverBox.x - coverBox.width - 22}px`,
        "--about-hero-signature-y": `${stageBox.y + stageBox.height - coverBox.y - coverBox.height - 18}px`,
      });
      for (const tile of selectAll(".hero-tile")) {
        const tileBox = layoutBox(tile);
        const deltaX =
          tileBox.x + tileBox.width / 2 - coverBox.x - coverBox.width / 2;
        const deltaY =
          tileBox.y + tileBox.height / 2 - coverBox.y - coverBox.height / 2;
        const distance = Math.hypot(deltaX, deltaY) || 1;
        setVariables(tile, {
          "--about-hero-dx": `${(deltaX / distance) * stageBox.width * 0.5}px`,
          "--about-hero-dy": `${(deltaY / distance) * stageBox.height * 0.5}px`,
        });
      }
    }
    let slabOffset = 0;
    for (const slab of selectAll(".feature-panel")) {
      setVariables(slab, {
        "--about-features-at": `${slabOffset}px`,
        "--about-features-next": `${slabOffset + slab.offsetHeight}px`,
      });
      slabOffset += slab.offsetHeight;
    }
    if (networkView && networkTrack) {
      const horizontalTravel = Math.max(
        0,
        networkTrack.scrollWidth - networkView.clientWidth
      );
      const readingPace = 1.6;
      const scrollDistance = horizontalTravel * readingPace;
      const finalReadingSpace =
        horizontalTravel > 0 ? window.innerHeight * 0.65 : 0;
      setVariables(networkSection, {
        "--about-networks-run": `${horizontalTravel}px`,
        "--about-networks-scroll-distance": `${scrollDistance}px`,
        "--about-networks-scroll-space": `${scrollDistance + finalReadingSpace}px`,
      });
      const trackBox = networkTrack.getBoundingClientRect();
      for (const chip of selectAll(".network-chip")) {
        const chipBox = chip.getBoundingClientRect();
        const start =
          chipBox.left - trackBox.left - networkView.clientWidth / 2;
        setVariables(chip.querySelector(".network-chip__fill"), {
          "--about-networks-a": `${Math.max(0, start) * readingPace}px`,
          "--about-networks-b": `${Math.max(Math.max(0, start) + 1, start + chipBox.width) * readingPace}px`,
          "--about-networks-from": `${Math.min(1, Math.max(0, -start / (chipBox.width || 1)))}`,
        });
      }
    }
    for (const principle of selectAll(".principle-card")) {
      setVariables(principle, {
        "--about-principles-rise": `${principle.querySelector<HTMLElement>(".principle-fill")?.offsetHeight ?? 0}px`,
      });
    }
    const footer = select("#about-footer");
    const footerYear = select(".footer-signature");
    if (footer && footerYear) {
      setVariables(footerYear, {
        "--footer-signature-x": `${-Math.max(0, footer.clientWidth - footerYear.offsetWidth - 40) * 0.6}px`,
      });
    }
    queueScroll();
  };

  const configure = () => {
    const enabled =
      preference.matches &&
      typeof CSS !== "undefined" &&
      CSS.supports("animation-timeline: view()");
    page.toggleAttribute("data-motion-enabled", enabled);
    if (!enabled) {
      for (const key of keys) {
        key.classList.remove("is-on");
      }
      return;
    }
    for (const group of selectAll("[data-stagger]")) {
      for (const [index, item] of [...group.children].entries()) {
        if (item instanceof HTMLElement) {
          setVariables(item, {
            "--item-count": `${group.children.length}`,
            "--item-index": `${index}`,
          });
        }
      }
    }
    if (networkView) {
      networkView.scrollLeft = 0;
    }
    measure();
  };

  let visibility: IntersectionObserver | undefined;
  if (typeof IntersectionObserver !== "undefined" && stage) {
    visibility = new IntersectionObserver((entries) => {
      stage.classList.toggle("is-idle", !entries[0]?.isIntersecting);
    });
    visibility.observe(stage);
  }
  const resize =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(measure);
  resize?.observe(page);
  preference.addEventListener("change", configure);
  window.addEventListener("scroll", queueScroll, { passive: true });
  window.addEventListener("resize", measure);
  configure();
  const measureAfterFonts = async () => {
    await document.fonts?.ready;
    if (!disposed) {
      measure();
    }
  };
  void measureAfterFonts();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    delete page.dataset.motionEnabled;
    visibility?.disconnect();
    resize?.disconnect();
    preference.removeEventListener("change", configure);
    window.removeEventListener("scroll", queueScroll);
    window.removeEventListener("resize", measure);
  };
}

export function AboutMotion() {
  useEffect(() => {
    const page = document.querySelector<HTMLElement>("[data-about-page]");
    if (page) {
      return initialiseAboutMotion(page);
    }
  }, []);
  return null;
}
