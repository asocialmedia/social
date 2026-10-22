# Community Posts collapsing header

The responsive web Posts page now has one scroll owner for the banner, community identity, section navigation, filters, and posts. The section navigation sticks at the top of that viewport. During the last 72 pixels of the large header leaving view, the compact avatar, name, and a/slug ease into that same row. Posts, Chat, and the mobile/tablet sidebar trigger remain accessible.

Motion uses opacity and transforms driven by Motion values, without scroll-driven React state or animated layout dimensions. Reduced motion removes spring, translation, and scale. A named, keyboard-focusable scroll region supports keyboard browsing. Long identities truncate within the available space. Empty feeds retain sufficient height for the large header to scroll away. Filter changes scroll to the filter controls below the compact bar rather than reopening the banner.

Validation:

- Navigation/loading/accent regression tests: 11 passed, 36 assertions.
- Workspace navigation and community feed filter tests: 8 passed, 33 assertions, including compact identity coexisting with sidebar and Posts/Chat navigation.
- Repository formatting/lint and type checks run for this change.
- Browser verification was blocked by the browser tool's URL security policy when selecting the existing localhost community page. No alternative browser access was attempted.

Visual acceptance still required: expanded/collapsed/reversed scrolling at 320px, phone, tablet, and desktop widths; long names; both themes; reduced motion; keyboard Page Up/Down; filter changes; sidebar open/close; infinite loading. No visual performance measurements or native device testing are claimed. This change targets responsive web; native code is unchanged.
