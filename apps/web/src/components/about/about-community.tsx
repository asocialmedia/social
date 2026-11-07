import { siteConfig } from "@asm/ui/meta/site";

import { aboutQuestions } from "./about-content";
import { ActionLink, Highlight, Photo, Rule } from "./about-primitives";
import type { AboutStyle } from "./about-primitives";

const stories = [
  {
    color: "sage",
    detail:
      "Explore posts, people and interests. You do not need an account to start reading.",
    end: ".",
    label: "Follow the interesting bit",
    mark: "a good detour",
    photo: "space",
    start:
      "A question about space becomes a rabbit hole about photography. A stranger becomes your favourite creator. Leave room for ",
    title: "For the curious",
  },
  {
    color: "orange",
    detail:
      "Share original posts and media, start a conversation and build a presence through contribution.",
    end: ".",
    label: "Put something into the world",
    mark: "your kind of work",
    photo: "making",
    start:
      "The half-finished sketch. The thing you built this weekend. The song only twelve people have heard. There should be room for ",
    title: "For the makers",
  },
  {
    color: "lavender",
    detail:
      "Find communities, bookmark the good stuff and join in on your own terms.",
    end: ".",
    label: "Lurking is a valid pastime",
    mark: "Both belong here",
    photo: "music",
    start:
      "Some days you have a lot to say. Some days you just want to read about someone else’s very specific obsession. ",
    title: "For the quietly social",
  },
] as const;

export function AboutStories() {
  return (
    <section id="about-stories">
      <div className="story-head page-gutter">
        <Rule />
        <h2 className="section-heading">A place for all your sides.</h2>
      </div>
      <div className="story-list">
        {stories.map((story) => (
          <article
            className="story-case"
            key={story.title}
            style={
              { "--case-color": `var(--about-${story.color})` } as AboutStyle
            }
          >
            <div className="story-portrait">
              <span className="story-glyph" aria-hidden="true">
                ↗
              </span>
              <figure className="story-photo tinted-photo" data-reveal="tint">
                <Photo photo={story.photo} className="h-full" />
              </figure>
              <p className="story-who">
                <strong>{story.title}</strong>
                <span className="caption">{story.label}</span>
              </p>
            </div>
            <div className="story-quote">
              <div className="story-text subheading">
                <p>
                  {story.start}
                  <Highlight color="paper">{story.mark}</Highlight>
                  {story.end}
                </p>
              </div>
              <p className="story-fact caption">
                <Rule />
                {story.detail}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function AboutParticipation() {
  return (
    <section id="about-participate">
      <div className="page-gutter">
        <div className="participate-head editorial-grid">
          <Rule />
          <h2 className="section-heading">
            Built in public.
            <br />
            Better with you.
          </h2>
          <p className="body-copy">
            Open source is an invitation to take part. You do not have to write
            code to help make this a better place.
          </p>
        </div>
        <ul className="participate-grid" data-stagger>
          {[
            {
              body: "Share something worth finding. Welcome someone new. Give a thoughtful answer.",
              photo: "people",
              title: "Show up",
            },
            {
              body: "Read the source, ask why something works this way and challenge our assumptions.",
              photo: "reading",
              title: "Be curious",
            },
            {
              body: "Report a bug clearly, suggest an improvement or help someone reproduce a problem.",
              photo: "making",
              title: "Make it better",
            },
            {
              body: "Contribute a fix, improve the docs or explore an idea in your own fork.",
              photo: "code",
              title: "Build with us",
            },
          ].map((item, index) => (
            <li
              className="participate-item"
              key={item.title}
              style={
                {
                  "--portrait-angle": `${[8, -4, -4, 8][index]}deg`,
                  "--portrait-x": `${22.959 - index * 15.306}vw`,
                  "--portrait-y": index % 2 ? "-12%" : "12%",
                } as AboutStyle
              }
            >
              <figure className="participate-photo tinted-photo">
                <Photo
                  photo={item.photo as "people" | "reading" | "making" | "code"}
                  className="h-full"
                />
              </figure>
              <h3 className="subheading">{item.title}</h3>
              <p className="caption participate-role">{item.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function AboutQuestions() {
  return (
    <section id="about-questions">
      <div className="question page-gutter editorial-grid">
        <div className="question-head">
          <Rule />
          <h2 className="section-heading">
            Fair questions.
            <br />
            Straight answers.
          </h2>
          <p className="body-copy">
            An ambitious direction is only useful when we are clear about what
            exists today.
          </p>
        </div>
        <div className="question-list">
          {aboutQuestions.map((entry) => (
            <details className="question-item" key={entry.question}>
              <summary>
                <span className="subheading">{entry.question}</span>
                <span
                  className="question-icon square-control"
                  aria-hidden="true"
                >
                  <span>+</span>
                </span>
              </summary>
              <p className="body-copy question-a">{entry.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AboutPrinciples() {
  return (
    <section id="about-principles">
      <div className="page-gutter">
        <div className="principle-head editorial-grid">
          <Rule />
          <h2 className="section-heading">
            Some things are
            <br />
            not up for debate.
          </h2>
          <p className="body-copy">
            These are commitments we intend to build and operate by. Our privacy
            policy and terms describe how the hosted service works today.
          </p>
        </div>
        <div className="principle-cards" data-stagger>
          {[
            {
              action: "Read our privacy policy",
              color: "sage",
              height: ".38",
              href: "/privacy",
              items: [
                "No sponsored posts between your friends",
                "No selling your personal data",
                "No paid shortcuts to social reach",
                "Your attention is yours",
              ],
              number: "0",
              qualifier: "ever",
              title: "Ads",
            },
            {
              action: "Know the ground rules",
              color: "lavender",
              height: ".67",
              href: "/toc",
              items: [
                "No guilt trips or fake urgency",
                "Clear boundaries for personal context",
                "No AI training on private content without permission",
                "Real choice is the direction we build toward",
              ],
              number: "You",
              qualifier: "first",
              title: "Agency",
            },
            {
              action: "See how it works",
              color: "orange",
              height: "1",
              href: siteConfig.links.github,
              items: [
                "Published under AGPL-3.0",
                "Read, run, modify and fork the software",
                "Contribute ideas, fixes and criticism",
                "Respect the licence and separate brand terms",
              ],
              number: "Open",
              qualifier: "code",
              title: "Source",
            },
          ].map((principle) => (
            <article
              className="principle-card"
              key={principle.title}
              style={
                {
                  "--plan-color": `var(--about-${principle.color})`,
                  "--principle-height": principle.height,
                } as AboutStyle
              }
            >
              <div className="principle-stage">
                <span className="principle-fill" aria-hidden="true" />
                <div className="principle-top">
                  <h3 className="subheading">{principle.title}</h3>
                  <p className="principle-value">
                    {principle.number}
                    <small>{principle.qualifier}</small>
                  </p>
                </div>
              </div>
              <ul className="principle-list body-copy">
                {principle.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <ActionLink href={principle.href}>{principle.action}</ActionLink>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
