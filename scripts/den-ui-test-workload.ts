import type { MessagePayload } from "../apps/web/src/lib/messages/crypto";

export const DEN_UI_TEST_ID = "seed-den55-ui";
export const DEN_UI_TEST_PASSWORD = "Test@1234";
export const DEN_UI_TEST_MEMBERS = Array.from({ length: 55 }, (_, index) => {
  const username =
    index === 0
      ? "den55_owner"
      : `den55_member${String(index).padStart(2, "0")}`;
  return {
    avatarUrl: `/avatars/default-${(index % 2) + 1}.png`,
    displayName:
      index === 0
        ? "Test Den Owner"
        : `Test Member ${String(index).padStart(2, "0")}`,
    email: `${username}@test.local`,
    id: `seed-${username}`,
    username,
  };
});

const LINKS = [
  "https://react.dev/",
  "https://developer.mozilla.org/",
  "https://www.wikipedia.org/",
  "https://github.com/prisma/orm",
];
const IMAGE =
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=960&h=640&fit=crop&auto=format";

export function buildDenUiTestMessages() {
  return Array.from({ length: 1000 }, (_, index) => {
    const member = DEN_UI_TEST_MEMBERS[index % DEN_UI_TEST_MEMBERS.length];
    if (!member) {
      throw new Error("Test member missing");
    }
    const number = index + 1;
    let payload: MessagePayload = {
      content: `Message ${number}: ${member.displayName} checking den scrolling, search, and shared content. ${index % 7 === 0 ? "A longer message with enough detail to wrap onto several lines on a phone, helping exercise bubble sizing and responsive layouts." : "Everything is ready for the next test."}`,
      type: "text",
    };
    if (index % 10 === 9) {
      payload = {
        content: `Image ${number}: a landscape shared by ${member.displayName}.`,
        images: [{ height: 640, url: IMAGE, width: 960 }],
        kind: "image",
        type: "media",
      };
    } else if ((index % 20) % 4 === 3) {
      payload = {
        content: `Link ${number}: ${LINKS[Math.floor(index / 4) % LINKS.length]} — shared by ${member.displayName}.`,
        type: "text",
      };
    }
    return { payload, senderId: member.id };
  });
}
