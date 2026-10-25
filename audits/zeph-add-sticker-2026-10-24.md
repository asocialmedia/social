# Zeph Add sticker artwork

Generated with the built-in image generation tool using the repository's Zeph identity and no-media illustration as references. The finished illustration is a grey winking Zeph with a peeled corner, dotted die-cut edge, and a plus badge inside the image. The picker provides the accessible Add sticker label. The outer tile border was removed at the user's request.

Assets:

- Web: `/home/haze/repos/social/apps/web/assets/general/zeph-add-sticker.webp`
- Native: `/home/haze/repos/social/apps/mobile/assets/images/zeph-add-sticker.webp`

Both are identical 256 × 256 transparent WebP files, 13,848 bytes each. The generated PNG master remains at `/home/haze/.codex/generated_images/01a168f8-2039-7213-bd14-50689e85bb62/exec-c7eb6e8b-8aef-466e-adf7-a06f6f632718.png`. Asset preparation only resized and encoded the generated image, preserving alpha.

The Add sticker tile replaces the toolbar Create sticker button and appears first in each editable collection, including empty and loading states. Browser checks confirmed that the image loads, the tile opens the single-file chooser, and the outer border measures 0 px. Desktop sticker action buttons now measure 28 × 28 px; touch buttons remain 44 × 44 px. Web/native typechecks and scoped lint/format checks passed. Native visual interaction was not tested on a physical device.

## Final generation prompt

Use case: stylized-concept. Asset type: a single small UI 'Add sticker' mascot illustration for a chat sticker keyboard, on a genuinely transparent background. Image 1 is the identity reference for Zeph: retain this exact friendly three-lobed cloud / speech-bubble silhouette, lower speech tail, pill eyes and curved smile, glossy soft 3D style. Image 2 is supporting reference for Zeph's small rounded hands and playful expressive poses; do not reproduce its broken photo prop or sad expression. Create a fresh, imaginative grayscale Zeph sticker: silver-grey soft vinyl / clay Zeph peeking playfully out of its own gently peeled sticker corner, one rounded hand lifting the curled corner and another presenting a prominent bold plus (+) badge integrated into the illustration at the lower right. Cheerful slight head tilt, one eye winking, welcoming smile. Make the silhouette itself edged with a clean medium-grey dotted / short-dash die-cut outline and subtle pale inner lip. Muted grey monochrome throughout, charcoal facial features, lighter silver plus with strong readable contrast. Keep Zeph recognizable as the provided mascot even in monochrome. The plus must be clearly readable at a tiny 64-pixel display size and be an actual part of the image, not external UI. Square, centered composition with about 7% clear padding, one mascot only, no scene, no rectangular background, no separate icons, no text or letters, no watermark. The UI will provide the exact 'Add sticker' label underneath. Use a clean bold silhouette and restrained detail so it remains legible as a small first tile in a dense sticker grid. Deliver transparent alpha.
