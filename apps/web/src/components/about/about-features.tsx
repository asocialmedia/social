import { ActionLink, Photo, Rule } from "./about-primitives";
import type { AboutStyle } from "./about-primitives";

const features = [
  {
    action: "Find something good",
    body: "A feed that learns what interests you, public Bluesky discovery alongside native posts, and different views when you want a change of pace. The aim is to help you find things worth caring about, including people you have never heard of.",
    color: "orange",
    href: "/discover",
    items: [
      "For you, Latest, Trending and Following",
      "Explore people, posts and interests",
      "Native posts and public Bluesky discovery",
      "Bookmarks for the good stuff",
      "Source filters when you want to focus",
    ],
    lead: "Follow your curiosity. Find a new obsession.",
    name: "Discover.",
    photo: "reading",
    tint: "lavender",
  },
  {
    action: "Find your people",
    body: "The niche community. The thoughtful reply. The person who understands exactly why you have strong opinions about this. Communities give those connections a home, and Aura recognises the ways you show up.",
    color: "sage",
    href: "/communities",
    items: [
      "Communities around shared interests",
      "Fleets for ideas, links and original work",
      "Eddies for the conversation that follows",
      "Aura for participation and contribution",
      "Reporting and moderation for shared spaces",
    ],
    lead: "The best part of the internet is still people.",
    name: "Belong.",
    photo: "people",
    tint: "orange",
  },
  {
    action: "Make yourself at home",
    body: "Share a passing thought, make a short video, talk in a smaller circle or spend the evening quietly reading. You do not have to turn every interest into a personal brand to belong here.",
    color: "lavender",
    href: "/signup",
    items: [
      "Posts with text, links and media",
      "Gusts for short-form video",
      "Direct and group conversations",
      "Public browsing before you sign up",
      "Web and Android, with iOS still ahead",
    ],
    lead: "A whole person does not fit in one format.",
    name: "Be you.",
    photo: "art",
    tint: "sage",
  },
] as const;

export function AboutFeatures() {
  return (
    <section id="about-features">
      <div className="feature-head page-gutter editorial-grid">
        <Rule />
        <h2 className="section-heading">
          Good things happen
          <br />
          when the right people meet.
        </h2>
        <p className="body-copy">
          A place to discover, to contribute, and to feel a little less
          scattered across the internet.
        </p>
      </div>
      <div className="feature-stack" data-stagger>
        {features.map((feature) => (
          <article
            className="feature-panel"
            key={feature.name}
            style={
              {
                "--photo-tint": `var(--about-${feature.tint})`,
                "--slab-color": `var(--about-${feature.color})`,
              } as AboutStyle
            }
          >
            <div className="feature-panel__in page-gutter editorial-grid">
              <Rule />
              <h3 className="display-heading feature-name">{feature.name}</h3>
              <div className="feature-copy">
                <p className="subheading">{feature.lead}</p>
                <p className="body-copy">{feature.body}</p>
              </div>
              <Photo photo={feature.photo} className="feature-photo">
                <span className="feature-dots" aria-hidden="true" />
              </Photo>
              <div className="feature-list">
                <p className="eyebrow">Make it your own</p>
                <ul className="body-copy">
                  {feature.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <ActionLink href={feature.href}>{feature.action}</ActionLink>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
