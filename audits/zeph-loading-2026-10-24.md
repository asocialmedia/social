# Zeph loading, greeting, and emoji tone palette

Replaced app-rendered Lucide loaders, native ActivityIndicators, shared 3D spinners, CSS border spinners, and auth verification rings with contextual Zeph image assets. Shared web/native components cover inline controls and full loading states. Search uses a magnifying glass, media uses photo cards, security uses a padlock, conversations use Zeph with speech bubbles, and general waiting uses an hourglass. Conversation list/thread native placeholders and the web GIF picker also use Zeph. Determinate progress, camera recording indicators, and structural content placeholders retain their functions.

The web loader uses eager, directly served, small WebP assets, with a gentle pulse enabled only when reduced motion is not requested. Native assets render without continuous spinning. Existing loader dimensions and native accessibility labels remain supported. The opening-conversation loader measures 96px. Error and retry handling remain available.

Empty normal conversations show only the recipient greeting followed by a dedicated waving Zeph. Dens use “Say hi in [room]”. The encryption paragraph is removed from the empty transcript. Native adds the same greeting to an empty inverted list.

The shared web emoji picker uses a six-choice skin-tone palette with hand previews, selected checkmark, current tone label, and arrow/Home/End keyboard navigation. Selecting a tone closes the palette and updates emoji results. Escape dismisses it and returns focus. Mobile touch checks measured every choice at 48px tall and at least 44px wide, within a 355px CSS viewport.

## Assets

Built-in image generation was used for four loading poses and the greeting. The message loader reuses the existing `apps/web/assets/general/messages.png` illustration. All finished assets are copied into both app workspaces, with transparent alpha preserved.

Web assets in `/home/haze/repos/social/apps/web/assets/general/`:

- `zeph-loading-waiting.webp`: 256 × 256, 14,570 bytes
- `zeph-loading-search.webp`: 256 × 256, 13,168 bytes
- `zeph-loading-media.webp`: 256 × 256, 13,946 bytes
- `zeph-loading-security.webp`: 256 × 256, 13,054 bytes
- `zeph-loading-messages.webp`: 256 × 256, 11,128 bytes
- `zeph-say-hi.webp`: 384 × 384, 21,418 bytes

Identical files are saved in `/home/haze/repos/social/apps/mobile/assets/images/`. Assets were resized and encoded after generation; the original masters remain in `/home/haze/.codex/generated_images/01a168f8-2039-7213-bd14-50689e85bb62/`.

## Prompt set

Reference image for every generated pose: `/home/haze/repos/social/apps/web/assets/zeph.png`.

Shared loading prompt: “Use case: stylized-concept. Project asset: a small loading-state mascot illustration for Asocialmedia, on a genuinely transparent background. The attached image is an identity reference only: preserve Zeph's three-lobed cloud/speech bubble outline, pointed lower speech tail, sunny yellow body, thick glossy orange rim, orange pill eyes and smile, soft 3D vinyl/clay material. Create a new pose: [pose below] One character, square canvas, centered with about 8 percent clear padding, no ground, no backdrop, no text or letters, no border, no sparkles, no spinner or motion lines. Clear bold silhouette, prop recognizable at 48 pixels. Keep lighting subtle, no external glow or cast shadow outside mascot. Transparent alpha.”

- Waiting pose: “Zeph is cheerfully waiting, gently holding a small cream hourglass with orange sand. Calm welcoming smile, one small rounded hand resting on hourglass. Compact shape.” Master `exec-38eaf070-f3fc-4fcf-94ed-deb46a952112.png`.
- Search pose: “Zeph is curiously looking through a large cream magnifying glass held by one small rounded hand, warm focused smile. Compact shape.” Master `exec-0bc70c81-2e72-40b2-9c00-3d198f4bbe55.png`.
- Media pose: “Zeph is carefully carrying two overlapping cream photo cards, front card with simple orange mountains and small sun. Cheerful focused smile. Compact shape.” Master `exec-5e775c34-82f9-4fc0-8fa0-aa88c320ea74.png`.
- Security pose: “Zeph is gently hugging a small cream padlock with an orange keyhole, smiling reassuringly, two small rounded hands. Compact shape.” Master `exec-f04f2039-daff-467f-a6e9-513859c397d6.png`.

Greeting prompt: “Use case: stylized-concept. Project asset: a dedicated friendly empty direct-message greeting mascot on genuinely transparent background. Attached image is Zeph identity reference: preserve the three-lobed yellow speech cloud silhouette, thick orange glossy rim, pointed lower speech tail, orange vertical pill eyes and curved orange smile, soft 3D vinyl/clay material. Create a fresh welcoming Zeph with a slight playful tilt, one small rounded hand raised in a clear wave beside the face and the other holding a tiny cream speech bubble with a simple orange heart (no text). Warm happy expression, not exaggerated. One character only, compact centered square composition with 8 percent clear padding, no background or ground, no glow, no external cast shadow, no letters or watermark. Clear strong silhouette and minimal details readable at 128 pixels. True transparent alpha.” Master `exec-9b439f2d-6f85-4617-89f7-c3ab4ec18c86.png`.

## Validation

- 12 focused tests pass: loader status/accessibility/dimensions/context, DM and den greetings, recipient-name escaping, tone-aware catalog search, and shared-reference footer regression.
- Scoped oxfmt and oxlint pass across 123 source/test files. Root autofix was avoided to preserve unrelated local work.
- Full `bun run check-types` passes for web, mobile, and the workspace packages.
- Browser control verified the palette selection, focus movement, toned emoji draft insertion, narrow touch targets, empty-chat greeting, absence of the old paragraph, and a held loading request showing the real Zeph opening-conversation component.
- Screenshots: `zeph-loading-2026-10-24/greeting.jpg`, `emoji-tones.jpg`, and `opening-conversation.jpg`.
- The page-local anny fixture was restored for browser checks. It is a presentation fixture and does not persist messages or conversation state. A held loading request was released, touch emulation and viewport overrides were reset, and the temporary screenshot receiver finished.
- Native behavior was typechecked; it was not tested on a physical device.
