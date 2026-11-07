// oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The horizontal reading region needs keyboard scrolling.
import Link from "next/link";

import { networkSteps } from "./about-content";
import { Highlight, Photo, Rule } from "./about-primitives";
import type { AboutStyle } from "./about-primitives";

export function AboutJoin() {
  return (
    <section id="about-join">
      <div className="join page-gutter editorial-grid">
        <figure className="join-photo tinted-photo" data-reveal="tint">
          <Photo photo="music" className="h-full" />
        </figure>
        <div className="join-copy">
          <Rule />
          <h2 className="section-heading">
            The door’s open.
            <br />
            <Highlight color="orange">Come as you are.</Highlight>
          </h2>
          <p className="body-copy">
            You do not need an audience, a content strategy or an introduction.
            Start with a little curiosity.
          </p>
          <ol className="join-steps">
            {[
              [
                "Have a look around",
                "Read public posts, explore communities and see what catches your eye. You can browse without an account.",
              ],
              [
                "Find your kind of people",
                "Follow a few interesting voices. Save something good. Find the corner where your niche feels normal.",
              ],
              [
                "Add a little of yourself",
                "Make an account when you are ready. Share a fleet, join a conversation or just say hello. Quiet participation counts too.",
              ],
            ].map(([title, body], index) => (
              <li key={title}>
                <Rule />
                <span className="join-num">{index + 1}</span>
                <div>
                  <h3 className="subheading">{title}</h3>
                  <p className="body-copy">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <Link className="text-link" href="/">
            Take a look inside
          </Link>
        </div>
      </div>
    </section>
  );
}

export function AboutNetworks() {
  return (
    <section id="about-networks">
      <div className="network-pin">
        <div className="network-head page-gutter editorial-grid">
          <Rule />
          <h2 className="section-heading">
            Different networks.
            <br />
            One wider universe.
          </h2>
          <p className="body-copy network-intro">
            Good conversations should not stop at the border of an app. We are
            building toward a connected discovery experience, starting with
            public Bluesky content. Here is what is here and where we want to
            go.
          </p>
          <ul className="network-key" aria-label="Integration status">
            <li>
              <span
                className="network-swatch"
                style={{ "--chip": "var(--about-orange)" } as AboutStyle}
                aria-hidden="true"
              />
              Native to asocialmedia
            </li>
            <li>
              <span
                className="network-swatch"
                style={{ "--chip": "var(--about-lavender)" } as AboutStyle}
                aria-hidden="true"
              />
              Available discovery
            </li>
            <li>
              <span
                className="network-swatch"
                style={{ "--chip": "var(--about-sage)" } as AboutStyle}
                aria-hidden="true"
              />
              Vision and ongoing work
            </li>
          </ul>
        </div>
        <section
          className="network-view"
          tabIndex={0}
          aria-label="Our open social web direction; scroll to explore"
        >
          <ol className="network-track" data-stagger>
            {networkSteps.map((step, index) => (
              <li className="network-step" key={step.name}>
                <h3 className="network-name">
                  {step.name}
                  <span>{step.label}</span>
                </h3>
                <ul className="network-chips">
                  {[
                    [step.first, step.body],
                    [step.second, step.detail],
                  ].map(([title, body]) => (
                    <li
                      className="network-chip"
                      key={title}
                      style={
                        {
                          "--chip": `var(--about-${["orange", "orange", "lavender", "sage", "sage", "sage"][index]})`,
                        } as AboutStyle
                      }
                    >
                      <span className="network-chip__fill" aria-hidden="true" />
                      <span className="network-date">{title}</span>
                      <span className="network-what">{body}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <span className="network-line" aria-hidden="true" />
        </section>
      </div>
    </section>
  );
}
