import { expect, test } from "bun:test";

import {
  buildDenUiTestMessages,
  DEN_UI_TEST_MEMBERS,
} from "./den-ui-test-workload";

test("test den has 55 unique accounts and 1000 messages covering every sender", () => {
  const messages = buildDenUiTestMessages();
  expect(DEN_UI_TEST_MEMBERS).toHaveLength(55);
  expect(
    new Set(DEN_UI_TEST_MEMBERS.map((member) => member.username)).size
  ).toBe(55);
  expect(messages).toHaveLength(1000);
  expect(new Set(messages.map((message) => message.senderId)).size).toBe(55);
});

test("history includes 100 image messages, 200 links, and 700 ordinary texts", () => {
  const messages = buildDenUiTestMessages();
  expect(
    messages.filter(({ payload }) => payload.type === "media")
  ).toHaveLength(100);
  expect(
    messages.filter(
      ({ payload }) =>
        payload.type === "text" && payload.content.startsWith("Link ")
    )
  ).toHaveLength(200);
  expect(
    messages.filter(
      ({ payload }) =>
        payload.type === "text" && payload.content.startsWith("Message ")
    )
  ).toHaveLength(700);
});
