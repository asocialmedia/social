"use client";

// The transparency probe lives in @asm/media so the web dialogs and the
// native crop engine choose PNG or JPEG by the same rule.
export { cropHasTransparency } from "@asm/media/image-edit";
