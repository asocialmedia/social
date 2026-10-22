# Community Posts collapsing header

The responsive web Posts page now has one scroll owner for the banner, community identity, section navigation, filters, and posts. The section navigation sticks at the top of that viewport. The original avatar, name, and a/slug translate and scale continuously into measured slots in that same row as the large header scrolls away. No second visible identity or identity opacity animation is used. The same nodes reverse back into the expanded header. Posts, Chat, and the mobile/tablet sidebar trigger remain accessible.

Identity motion uses transforms driven by Motion values, without scroll-driven React state or animated layout dimensions. A negative-offset sticky wrapper pins the identity once collapsed. Geometry is measured at mount, on layout resize, and after fonts load; layout coordinates remain stable when measuring while scrolled. Inset clipping keeps long text inside its compact slots. Only ancillary actions and member count fade away. Reduced motion switches directly between expanded and compact transforms without spring interpolation. A named, keyboard-focusable scroll region supports keyboard browsing. Long identities truncate within the available space. Empty feeds retain sufficient height for the large header to scroll away. Filter changes scroll to the filter controls below the compact bar rather than reopening the banner.

Validation:

- Navigation/loading/accent regression tests: 11 passed, 36 assertions.
- Workspace navigation and community feed filter tests: 8 passed, 33 assertions, including compact identity coexisting with sidebar and Posts/Chat navigation.
- Transform tests cover expanded identity, phone/desktop collapsed endpoints, long-name clipping, overscroll, and reversal: 4 passed.
- Repository formatting/lint and type checks run for this change.
- Browser verification was blocked by the browser tool's URL security policy when selecting the existing localhost community page. No alternative browser access was attempted.

Visual acceptance still required: expanded/collapsed/reversed scrolling at 320px, phone, tablet, and desktop widths; long names; both themes; reduced motion; keyboard Page Up/Down; filter changes; sidebar open/close; infinite loading. No visual performance measurements or native device testing are claimed. This change targets responsive web; native code is unchanged.

## Scroll settling

When scrolling ends inside the header's transition range, the viewport smoothly settles to the nearer expanded or compact endpoint. This preserves the original identity transform and the transcript's normal scroll position beyond that range. Native scroll completion events are preferred; older browsers use one 160 ms idle timer. Held pointers and scroll keys defer settling, new wheel/touch/key input interrupts it, and opening the sidebar or unmounting removes the controller. Reduced motion uses an instant settle. No scroll-driven React state or new frame loop was added.

Seven snap controller tests cover both endpoints, unrestricted post reading, unreachable destinations, held touch/key input, fresh-input cancellation, reduced motion, fallback idle handling, and disposal. Together with the transform tests, 11 tests passed. Lint and repository type checks passed. Browser visual verification remains blocked by the previously recorded URL policy; smooth-scroll feel on actual browsers and devices remains unverified.
