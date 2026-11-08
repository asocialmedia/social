import { siteConfig } from "@asm/ui/meta/site";
import Link from "next/link";

import { ActionLink, Highlight, Rule } from "./about-primitives";
import type { AboutStyle } from "./about-primitives";

export function AboutBuild() {
  return (
    <section id="about-build">
      <div className="build page-gutter editorial-grid">
        <div className="build-copy">
          <Rule />
          <h2 className="display-heading build-title">
            A better corner.
            <br />
            <Highlight color="orange">Let’s build it.</Highlight>
          </h2>
          <p className="body-copy">
            We are building the place we want to spend time in. Cozy, curious,
            slightly unhinged, and still a work in progress. If that sounds like
            your kind of internet, there is room for you here.
          </p>
          <dl className="build-details body-copy">
            <div>
              <dt className="eyebrow">Start here</dt>
              <dd>
                <Link className="text-link" href="/">
                  Browse the live feed
                </Link>
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Android</dt>
              <dd>
                <a
                  className="text-link"
                  href={`${siteConfig.links.github}/releases/latest`}
                >
                  Downloads and releases
                </a>
              </dd>
            </div>
            <div>
              <dt className="eyebrow">iOS</dt>
              <dd>On the way.</dd>
            </div>
          </dl>
        </div>
        <div className="build-invitation flex flex-col gap-8 bg-[#0b0b0b] p-6 text-white sm:p-10">
          <p className="eyebrow">Your companion, your verse.</p>
          <h3 className="section-heading">
            The next good
            <br />
            thing might
            <br />
            start with you.
          </h3>
          <p className="body-copy">
            An idea. A conversation. A bug report. A beautifully specific
            opinion. Bring something only you could bring.
          </p>
          <ActionLink accent href="/signup">
            Come hang out
          </ActionLink>
          <a className="light-link self-start" href={siteConfig.links.github}>
            Or help build the place ↗
          </a>
          <p className="caption">No introduction required.</p>
        </div>
      </div>
    </section>
  );
}

export function AboutFooter() {
  return (
    <footer id="about-footer">
      <div className="footer-cols editorial-grid">
        <div className="footer-col">
          <p className="eyebrow">Our little corner</p>
          <p className="body-copy">
            Your people.
            <br />
            Your interests.
            <br />A wider world.
          </p>
        </div>
        <div className="footer-col">
          <p className="eyebrow">In the open</p>
          <ul className="body-copy">
            <li>
              <a className="light-link" href={siteConfig.links.github}>
                Source code
              </a>
            </li>
            <li>
              <a
                className="light-link"
                href={`${siteConfig.links.github}/issues`}
              >
                Ideas and issues
              </a>
            </li>
            <li>
              <a
                className="light-link"
                href={`${siteConfig.links.github}/releases`}
              >
                Releases
              </a>
            </li>
          </ul>
        </div>
        <nav className="footer-col" aria-label="Footer">
          <p className="eyebrow">Keep exploring</p>
          <ul className="body-copy">
            {[
              ["/", "Feed"],
              ["/about", "About"],
              ["/communities", "Communities"],
              ["/privacy", "Privacy"],
              ["/toc", "Terms"],
            ].map(([href, label]) => (
              <li key={href}>
                <Link className="light-link" href={href}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="footer-signature">you/us</p>
      </div>
      <p
        className="footer-mark"
        style={{ "--wordmark-length": 12 } as AboutStyle}
      >
        asocialmedia
      </p>
      <div className="footer-base caption">
        <p>© 2026 asocialmedia · Design via Singularity Works.</p>
        <p>
          The social network that knows you back. ·{" "}
          <a href="https://przknv.cc" rel="me">
            przknv.cc ↗
          </a>
        </p>
      </div>
    </footer>
  );
}
