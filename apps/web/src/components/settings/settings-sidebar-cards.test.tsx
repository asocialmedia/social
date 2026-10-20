import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  GithubProjectCard,
  SponsorProjectCard,
  SupportContactCard,
} from "./settings-sidebar-cards";

describe("Settings Sidebar Cards", () => {
  it("renders GithubProjectCard with repository links, description, and star button", () => {
    const html = renderToStaticMarkup(<GithubProjectCard />);

    expect(html).toContain("https://github.com/asocialmedia/social");
    expect(html).toContain("Star on GitHub");
    expect(html).toContain("asocialmedia");
    expect(html).toContain("/social");
    expect(html).toContain(
      "Building the last social platform you&#x27;ll ever need"
    );
  });

  it("renders SponsorProjectCard with description and GitHub Sponsors link", () => {
    const html = renderToStaticMarkup(<SponsorProjectCard />);

    expect(html).toContain("https://github.com/sponsors/asocialmedia");
    expect(html).toContain("Sponsor");
    expect(html).toContain("Sponsor on GitHub");
    expect(html).toContain("Help keep asocialmedia free, tracker-free");
  });

  it("renders SupportContactCard with description, hello@asocialmedia.cc and mailto link", () => {
    const html = renderToStaticMarkup(<SupportContactCard />);

    expect(html).toContain("hello@asocialmedia.cc");
    expect(html).toContain("mailto:hello@asocialmedia.cc");
    expect(html).toContain("Support");
    expect(html).toContain(
      "For any account, security, or general issue, reach out directly:"
    );
    expect(html).toContain("/support");
  });
});
