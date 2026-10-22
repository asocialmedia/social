# Community navigation UX audit

Scope: responsive web community Posts, Chat, channels/threads, sidebar navigation, and post filters. Findings are based on source inspection, component rendering, and DOM integration tests. Native app and browser/device visual acceptance are separate and were not performed.

| Finding | Change |
| --- | --- |
| Chat required opening the sidebar to return to Posts, while Posts exposed direct section tabs. | Both headers use the same Posts / Chat link component, active underline, touch targets, and section labels. Chat retains one header row and places section links at its right edge. |
| Switching sections discarded post filters and returned chat to the default channel. | Section tabs and sidebar links share a bounded session-only return-location store. Filters/sort and the last parent channel are remembered independently for each account/community. Private thread links and message content are not stored. |
| The mobile/tablet drawer mounted to the document body and used window-wide fixed positioning. At tablet widths this covered the root app navigation. | The drawer and backdrop portal into the community workspace, with absolute bounds and a workspace-relative maximum width. The root app sidebar is outside these bounds. The workspace establishes its own stacking context. |
| Drawer close and bottom navigation could lose their coordinated animation if replaced with a simple local panel. | Existing Radix modal/focus semantics, left slide, reverse close, and animated app dock are preserved. The dock remains inside the dialog focus scope and now uses the workspace bounds. |
| Narrow Chat headers would become crowded when adding section tabs. | The redundant community avatar is hidden below desktop width. Identity text can truncate, channel names take the subtitle space directly, and the full context remains in the accessible heading and conversation tools. No extra toolbar row reduces the transcript height. |
| Filters appeared as a prominent raised pill next to understated New/Top controls. | A neutral ghost toolbar control uses the same muted text, small outline icon, radius, and 44px touch target as adjacent app controls. Active filters retain a small count badge and descriptive accessible label. Filter form copy is concise. Existing popover/dialog primitives, draft/apply behavior, and active summaries remain. |
| Modified navigation clicks could close the original drawer while opening another tab. | Sidebar section links and Posts channel shortcuts close only on an actual Next navigation event. |

## Verification

- A DOM integration test opens the actual community drawer within a supplied workspace host, confirms the dialog/backdrop use absolute rather than fixed positioning, confirms the app navigation remains inside the dialog, verifies remembered Posts/Chat destinations, and exercises its Close control. The app dock itself is stubbed in this test; its animation is not measured.
- Component tests cover direct Chat-to-Posts access, active section semantics, thread back navigation, sidebar controls, and compact identity alongside section links.
- Store tests cover return destinations, account/community isolation, redundant-update avoidance, and the 32-entry bound.
- Existing header motion and community feed filter regression suites run alongside the changed navigation tests.
- Repository lint/format and type checks run for the final change.

## Remaining acceptance

Browser access was previously rejected by the browser tool's URL policy. No workaround was attempted. Screenshots, pixel alignment, low-end frame times, actual keyboard/gesture behavior, focus restoration after animated close, and software keyboard/device acceptance are not claimed as verified.

Manual acceptance should include widths 320, 390, 768, 1100, and 1440px; both themes; root sidebar expanded/collapsed; Posts-to-Chat-to-Posts with active filters; channel/thread back navigation; drawer Escape/backdrop/close/focus behavior; the reverse dock animation; guest and revoked-access states; long community/channel names; and filtered/empty feeds. Exact Posts scroll-anchor restoration across route switches is not added by this change.

Final automated results: 26 regression tests across five files plus one separate DOM integration test passed (104 assertions total). The DOM test runs separately because it stubs the app dock and installs a temporary DOM environment. The normal mobile dock now belongs to the workspace stacking context, keeping it beneath the local modal while its existing dock animation remains intact. Formatting/lint passed; type checks are also required by the commit hook.
