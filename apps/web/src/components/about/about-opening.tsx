import { siteConfig } from "@asm/ui/meta/site";
import Link from "next/link";

import { ActionLink, Highlight, Photo, Rule } from "./about-primitives";

export function AboutOpening() {
  return (
    <section id="about-opening">
      <div className="hero-stage">
        <div className="hero-tiles" data-stagger>
          {(
            [
              ["making", "Your ideas"],
              ["nature", "Outside"],
              ["code", "Making things"],
              ["heroMusic", "On repeat"],
              ["art", "Art rabbit holes"],
              ["space", "Big questions"],
              ["people", "Your people"],
              ["reading", "One more chapter"],
            ] as const
          ).map(([photo, label], index) => (
            <figure className="hero-tile" key={photo}>
              <Photo
                photo={photo}
                className="hero-tile__frame"
                eager={index < 6}
                sizes="(max-width: 767px) 42vw, 25vw"
              />
              <figcaption className="photo-label">{label}</figcaption>
            </figure>
          ))}
        </div>
        <div className="hero-ground" aria-hidden="true" />
        <div className="hero-cover">
          <div className="hero-head">
            <h1 className="display-heading hero-title">
              The internet,
              <br />a little closer.
            </h1>
            <p className="subheading hero-lead">
              Your people. Your interests. Your wonderfully weird corner of the
              internet. A social network built to bring them together.
            </p>
          </div>
          <div className="hero-actions">
            <ActionLink href="/" accent>
              Come look around
            </ActionLink>
            <a className="light-link" href="#about-experience">
              Meet asocialmedia
            </a>
          </div>
          <p className="hero-signature">
            <span className="sr-only">Made for </span>you/us
          </p>
        </div>
      </div>
      <div className="hero-second">
        <p className="display-heading hero-statement">
          Friends in one app. Artists in another. Your communities across five
          tabs. We’re building a place for{" "}
          <Highlight color="orange">your people</Highlight>,{" "}
          <Highlight>your curiosity</Highlight> and{" "}
          <Highlight color="sage">all your sides</Highlight>.
        </p>
        <ul className="hero-ledger">
          {[
            [
              "A place, with a point",
              "Make something. Find your people. Get far too invested in a very specific conversation. That is what we want being online to feel like.",
            ],
            [
              "No ads. No data sales.",
              "Your interests and identity are not inventory. These are foundations of the project, not perks you have to unlock.",
            ],
            [
              "Built in the open",
              "Read the code. Question the decisions. Help make it better. The people using a platform should be able to understand how it works.",
            ],
          ].map(([title, body]) => (
            <li key={title}>
              <Rule />
              <span className="eyebrow">{title}</span>
              <p className="body-copy">{body}</p>
            </li>
          ))}
        </ul>
        <Link className="light-link hero-more" href={siteConfig.links.github}>
          Read the source. Bring an opinion.
        </Link>
      </div>
    </section>
  );
}
