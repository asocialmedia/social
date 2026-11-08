import { expect, test } from "bun:test";

import { socialShareTargets } from "./share-targets";

test("social sharing preserves URLs and punctuation in each destination", () => {
  const url = "https://asocialmedia.cc/posts/12345678?media=2&foo=bar";
  const text = "Hello & welcome #asm";
  const targets = socialShareTargets(url, text, {
    description: text,
    mediaUrl: "https://asocialmedia.cc/media/thumb.jpg",
  });
  expect(targets.find((target) => target.platform === "reddit")?.url).toBe(
    `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`
  );
  expect(targets.find((target) => target.platform === "whatsapp")?.url).toBe(
    `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`
  );
});

test("social sharing covers web's nine platforms with matching intents", () => {
  const url = "https://asocialmedia.cc/posts/12345678";
  const text = "Check out this post!";
  const mediaUrl = "https://asocialmedia.cc/media/thumb.jpg";
  const targets = socialShareTargets(url, text, {
    description: text,
    mediaUrl,
  });
  expect(targets.map((target) => target.platform)).toEqual([
    "twitter",
    "facebook",
    "linkedin",
    "instagram",
    "pinterest",
    "reddit",
    "whatsapp",
    "discord",
    "email",
  ]);
  expect(
    targets.find((target) => target.platform === "instagram")
  ).toMatchObject({ copyFirst: true, url: "https://instagram.com/" });
  expect(targets.find((target) => target.platform === "pinterest")?.url).toBe(
    `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&media=${encodeURIComponent(mediaUrl)}&description=${encodeURIComponent(text)}`
  );
  expect(targets.find((target) => target.platform === "discord")?.url).toBe(
    `https://discord.com/channels/@me?message=${encodeURIComponent(`${text} ${url}`)}`
  );
});
