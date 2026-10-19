# Community chat mobile and navigation review — 19 October 2026

## Findings and corrections

The earlier layout stacked global navigation, community navigation, a conversation header and a large composer. That left too little room for messages on phones. The earlier component preview did not adequately expose the effect of all the surrounding community chrome.

Web conversations now have one compact community header and an expanding composer inside the visible viewport. Native timelines use the same focused structure with safe-area and keyboard handling. Secondary controls open over the conversation in sheets or dialogs. The community feed retains its existing navigation.

The design uses asocialmedia community avatars, typography, accent colors, role artwork and tactile surfaces. Conversations have plain names and message icons. Desktop uses the same focused conversation and picker instead of a permanent channel rail. Community, Posts, Chat, channels and threads remain the product terminology.

Navigation provides an explicit return to Posts, a conversation picker showing channels and current-channel threads, and a direct parent-channel destination from threads. The picker also includes a labeled Community posts link. Pins jump to their message. Closing channel settings returns to conversation details. Choosing Reply moves focus to the composer after the menu closes; quick reactions use keyboard-accessible menu items.

Message text uses the available width. Only metadata and grouped rows reserve room for the action target. Thread starter content is collapsed on web and available through details on native. Follow controls and private-thread creation do not take permanent transcript space. Empty-state prompts respect writing restrictions. Native grouping compares each message with the chronologically older message.

## Verification

Browser inspection used the actual CommunityPage and chat components with temporary deterministic API fixtures. It covered light and dark themes, channel and thread headers, conversation and details sheets, nested settings return, pins, reply focus and cancellation, multiline input and sending, long unbroken messages, and empty/read-only presentation. The fixture was removed after inspection.

At 390 × 844, the transcript measured 710 pixels (84% of the viewport); the composer bottom was at 835 pixels. At 320 × 568, the transcript measured 434 pixels and the composer bottom was at 559 pixels. Long messages produced no horizontal page overflow. A 390 × 360 viewport kept the composer visible and retained bottom anchoring without incorrectly offering Jump to latest. Desktop was inspected at 1280 × 900.

`bun run check` and `bun run check-types` passed. Fifteen focused tests passed across community route matching, payload bounds, timeline bounds and stale events, realtime serialization, rollout defaults, and native management requests.

These checks validate layout and control flow with mocked data. They do not establish authenticated browser end-to-end behavior or physical iOS/Android keyboard, gesture and screen-reader acceptance. Native layout and navigation changes require physical-device verification before release. The broader backend and release blockers in community-chat-review-2026-10-18.md still apply.
