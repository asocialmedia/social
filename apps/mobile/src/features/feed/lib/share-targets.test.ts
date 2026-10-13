import { expect, test } from "bun:test";

import { socialShareTargets } from "./share-targets";

test("social sharing preserves URLs and punctuation in each destination", () => {
  const url = "https://asocialmedia.cc/posts/12345678?media=2&foo=bar";
  const text = "Hello & welcome #asm";
  const targets = socialShareTargets(url, text);
  expect(targets.find((target) => target.platform === "reddit")?.url).toBe(
    `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`
  );
  expect(targets.find((target) => target.platform === "whatsapp")?.url).toBe(
    `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`
  );
});
