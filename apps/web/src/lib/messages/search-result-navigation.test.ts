import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { Window } from "happy-dom";

import { focusSearchResult } from "./search-result-navigation";

let dom: Window;
let container: HTMLElement;
let profile: HTMLButtonElement;
let message: HTMLButtonElement;

beforeEach(() => {
  dom = new Window();
  const section = dom.document.createElement("section");
  section.innerHTML =
    "<button data-search-result>Profile</button><button data-search-result disabled>Unavailable</button><button data-search-result>Message</button>";
  dom.document.body.append(section);
  container = section as unknown as HTMLElement;
  [profile, , message] = [...container.querySelectorAll("button")];
});

afterEach(() => dom.happyDOM.cancelAsync());

describe("unified search keyboard navigation", () => {
  test("moves from the input through profiles to messages and skips disabled profiles", () => {
    expect(focusSearchResult(container, "ArrowDown")).toBe(true);
    expect(dom.document.activeElement).toBe(profile);
    focusSearchResult(container, "ArrowDown", profile);
    expect(dom.document.activeElement).toBe(message);
    focusSearchResult(container, "ArrowUp", message);
    expect(dom.document.activeElement).toBe(profile);
  });

  test("supports boundaries, Home and End without trapping Tab or text entry", () => {
    focusSearchResult(container, "ArrowUp");
    expect(dom.document.activeElement).toBe(message);
    focusSearchResult(container, "ArrowDown", message);
    expect(dom.document.activeElement).toBe(message);
    focusSearchResult(container, "Home", message);
    expect(dom.document.activeElement).toBe(profile);
    focusSearchResult(container, "End", profile);
    expect(dom.document.activeElement).toBe(message);
    expect(focusSearchResult(container, "Tab", message)).toBe(false);
    expect(focusSearchResult(container, "n", message)).toBe(false);
    expect(focusSearchResult(null, "ArrowDown")).toBe(false);
  });
});
