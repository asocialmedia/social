import { experienceNotes } from "./about-content";
import { Rule } from "./about-primitives";

export function AboutExperience() {
  return (
    <section id="about-experience">
      <div className="experience-grid page-gutter editorial-grid">
        <div className="experience-intro">
          <Rule />
          <h2 className="section-heading">
            The social network
            <br />
            that knows you back.
          </h2>
          <p className="body-copy experience-lead">
            Not another place to start from zero every morning. A feed that gets
            more useful, a reputation that remembers your contribution, and
            space for the interests that make you you.
          </p>
        </div>
        <ol className="experience-notes">
          {experienceNotes.map((note, index) => (
            <li className="experience-note" key={note.title}>
              <span className="experience-key" aria-hidden="true">
                {index + 1}
              </span>
              <h3 className="subheading">{note.title}</h3>
              <p className="body-copy">{note.body}</p>
            </li>
          ))}
        </ol>
        <article
          className="field-guide"
          aria-label="An illustrated guide to asocialmedia"
        >
          <span className="field-guide-highlight" aria-hidden="true" />
          <header className="field-guide__head">
            <p className="eyebrow">asocialmedia · A field guide</p>
            <p className="field-guide-title">A little more you.</p>
            <p className="caption">
              Product illustration, not a live account or activity report.
            </p>
          </header>
          <div className="field-guide-section">
            <h3 className="eyebrow">1 · Find your current</h3>
            <dl className="experience-rows">
              {[
                ["For you", "Your interests"],
                ["Latest", "The newest posts"],
                ["Trending", "What’s picking up"],
                ["Following", "People you follow"],
              ].map(([term, definition]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{definition}</dd>
                </div>
              ))}
            </dl>
            <p className="caption">
              One feed is never the whole internet. Switch the view.
            </p>
          </div>
          <div className="field-guide-section">
            <h3 className="eyebrow">2 · Leave something worthwhile</h3>
            <div className="reputation-preview">
              <p className="reputation-label">Aura</p>
              <div className="experience-aura-art" aria-hidden="true">
                {[24, 42, 31, 55, 39, 62, 48, 71, 59, 78, 68, 90].map(
                  (height, index) => (
                    <span
                      key={height}
                      style={{
                        background:
                          index === 11
                            ? "var(--about-orange)"
                            : "var(--about-ink)",
                        height: `${height}%`,
                      }}
                    />
                  )
                )}
              </div>
            </div>
            <p className="caption">
              A reputation shaped by participation. Decorative bars, not a
              growth promise.
            </p>
          </div>
          <div className="field-guide-section">
            <h3 className="eyebrow">3 · Learn the local language</h3>
            <dl className="experience-rows">
              {[
                ["Fleet", "A post"],
                ["Eddy", "A reply"],
                ["Gust", "A short video"],
              ].map(([term, definition]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{definition}</dd>
                </div>
              ))}
            </dl>
            <p className="community-note">
              Find the people who get your very specific thing.
            </p>
          </div>
          <div className="field-guide-section">
            <h3 className="eyebrow">4 · Look beyond one app</h3>
            <dl className="experience-rows">
              <div>
                <dt>asocialmedia</dt>
                <dd>Your home base</dd>
              </div>
              <div>
                <dt>Bluesky discovery</dt>
                <dd>Available now</dd>
              </div>
              <div>
                <dt>Deeper interoperability</dt>
                <dd>Still ahead</dd>
              </div>
            </dl>
          </div>
        </article>
      </div>
    </section>
  );
}
