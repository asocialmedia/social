// Word pools and text builders for the dev content seeder. Pure: no database,
// no clock, no randomness of its own - every generator takes a seeded Rng, so
// the same seed always produces the same corpus.
//
// The app renders post and comment bodies verbatim, so the text is assembled
// from interchangeable fragments rather than one template per post: a few
// thousand fleets that all read identically make the feed look broken, which
// defeats the point of seeding it. Mentions and tags are embedded from the
// handles and tags that actually exist in the plan and returned alongside the
// text, so the caller can write the matching Mentions / PostToTag rows instead
// of leaving the renderer with links to nothing.

export interface Rng {
  chance: (probability: number) => boolean;
  int: (minInclusive: number, maxExclusive: number) => number;
  pick: <T>(items: readonly T[]) => T;
}

const ADJECTIVES = [
  "absolute",
  "afternoon",
  "ambient",
  "annual",
  "anxious",
  "bold",
  "borrowed",
  "brave",
  "brief",
  "bright",
  "broken",
  "calm",
  "careful",
  "cheap",
  "clever",
  "cold",
  "common",
  "crooked",
  "daily",
  "damp",
  "distant",
  "early",
  "empty",
  "expensive",
  "faint",
  "famous",
  "fatal",
  "favorite",
  "fifty",
  "flat",
  "foreign",
  "fresh",
  "gentle",
  "giant",
  "golden",
  "graceful",
  "gross",
  "heavy",
  "hidden",
  "hollow",
  "honest",
  "hungry",
  "infinite",
  "loud",
  "lucky",
  "modern",
  "narrow",
  "nervous",
  "noisy",
  "obvious",
  "ordinary",
  "patient",
  "perfect",
  "plain",
  "polite",
  "private",
  "quiet",
  "rare",
  "restless",
  "rough",
  "round",
  "royal",
  "rude",
  "sad",
  "salty",
  "serious",
  "sharp",
  "silent",
  "simple",
  "sleepy",
  "slow",
  "small",
  "smooth",
  "soft",
  "solid",
  "strange",
  "sudden",
  "sunny",
  "supper",
  "tender",
  "thick",
  "thin",
  "tidy",
  "tiny",
  "tired",
  "uneven",
  "upset",
  "useful",
  "warm",
  "weak",
  "weird",
  "wild",
  "winter",
  "wise",
  "wrong",
] as const;

const ANIMALS = [
  "badger",
  "bat",
  "bear",
  "bee",
  "bird",
  "camel",
  "cat",
  "crab",
  "crow",
  "deer",
  "dog",
  "dove",
  "eel",
  "elk",
  "falcon",
  "ferret",
  "finch",
  "fish",
  "fox",
  "frog",
  "goat",
  "goose",
  "hare",
  "hawk",
  "hen",
  "heron",
  "jay",
  "kite",
  "lark",
  "lemur",
  "lynx",
  "mole",
  "moose",
  "moth",
  "mouse",
  "newt",
  "otter",
  "owl",
  "panda",
  "panther",
  "penguin",
  "pigeon",
  "quail",
  "rabbit",
  "ram",
  "raven",
  "robin",
  "shark",
  "sheep",
  "shrew",
  "shrike",
  "sparrow",
  "squid",
  "squirrel",
  "starling",
  "swan",
  "tapir",
  "tiger",
  "vole",
  "wren",
  "yak",
] as const;

const PLACES = [
  "airport",
  "bakery",
  "barber",
  "bookshop",
  "bus stop",
  "cafe",
  "canal",
  "car park",
  "cinema",
  "coast",
  "corner",
  "depot",
  "dock",
  "farm",
  "ferry",
  "garden",
  "harbour",
  "hospital",
  "hotel",
  "kitchen",
  "library",
  "market",
  "museum",
  "office",
  "park",
  "pier",
  "playground",
  "pub",
  "railway",
  "river",
  "school",
  "station",
  "street",
  "studio",
  "theatre",
  "village",
  "warehouse",
  "yard",
] as const;

const TOPIC_NOUNS = [
  "answer",
  "attempt",
  "break",
  "budget",
  "change",
  "checklist",
  "debate",
  "draft",
  "experiment",
  "forecast",
  "gesture",
  "habit",
  "idea",
  "incident",
  "invoice",
  "lesson",
  "list",
  "method",
  "mistake",
  "note",
  "pattern",
  "plan",
  "problem",
  "question",
  "recipe",
  "record",
  "reminder",
  "review",
  "ritual",
  "routine",
  "rule",
  "setup",
  "story",
  "survey",
  "system",
  "theory",
  "timeline",
  "tip",
  "trick",
  "update",
] as const;

const OPENERS = [
  "Unpopular opinion:",
  "Small update:",
  "Long overdue thought:",
  "Reminder to self:",
  "Genuine question:",
  "Half-formed theory:",
  "Good news, sort of:",
  "Bad news:",
  "Weird morning:",
  "Quiet note:",
  "Today I learned:",
  "Still thinking about this:",
  "Counterpoint:",
  "A thing I keep forgetting:",
  "Finally got around to it:",
  "No idea why this works, but:",
  "Three months in:",
  "One year on:",
] as const;

const FLEET_BODIES = [
  "spent the whole {place} arguing about {topic} and somehow left with a better answer than I came in with",
  "the {topic} I keep circling back to is whether {adjective} habits actually hold up once the novelty wears off",
  "{adjective} {animal} in the {place} this morning, which is either a good omen or a very specific threat",
  "rewrote the {topic} from scratch because the old version assumed things that stopped being true",
  "the {adjective} part of building anything is deciding what to leave out, and then leaving it out",
  "told someone about my {topic} and they got the one question I had been avoiding for months",
  "{adjective} weather, {adjective} coffee, and a {topic} that finally makes sense",
  "every {place} I have worked in has had exactly one {animal} and they all had opinions",
  "the {topic} only works if you write it down before you think it is ready",
  "spent an hour on a {adjective} detail in the {place} and it is the only part anyone will remember",
  "my {topic} was wrong for about two years and nobody had the heart to say so",
  "there is a {adjective} version of this {topic} and a boring version, and I have been doing the boring one",
  "the {animal} outside the {place} has started showing up at the same time every day",
  "reading back through old {topic} notes and honestly most of it holds up, which is {adjective}",
  "a {adjective} {topic} is mostly a list of things you were wrong about, in the order you found out",
] as const;

const FLEET_CLOSERS = [
  "Anyway. Back to it.",
  "Will report back if it survives contact with reality.",
  "Curious how other people handle this.",
  "No notes.",
  "That is the whole update.",
  "More soon, probably.",
  "Sending this one into the void.",
  "Happy to be talked out of it.",
  "Correction welcome.",
  "That is where I am at.",
] as const;

const GUST_CAPTIONS = [
  "golden hour, no filter",
  "the {place} before everyone shows up",
  "tried the {adjective} approach again",
  "this {animal} refused to cooperate",
  "somewhere between the {place} and home",
  "{adjective} light, quiet day",
  "a good {topic}, for once",
  "worth the walk to the {place}",
  "the {animal} cameo was unplanned",
  "no notes, just {adjective} weather",
] as const;

const COMMENT_LINES = [
  "this is the clearest version of the {topic} I have read all week",
  "the {adjective} detail at the end is what got me",
  "been saying this for months and getting nowhere, so thank you",
  "the {place} version of this is a completely different problem",
  "do you have a source for the {topic} part? asking on behalf of the third person who read this thread",
  "I think the {adjective} case is the interesting one and it gets skipped",
  "this aged well",
  "read this twice and still thinking about the second half",
  "the {animal} comparison sold it",
  "respectfully disagree with the {topic} take but not the tone",
  "saving this for the next {place} argument",
  "we tried the {adjective} variant and it fell apart within a week",
  "the short version is much better than the long version",
  "every {place} has one of these problems and nobody writes them down",
  "okay this actually changed my mind about the {topic}",
  "the {adjective} middle section is where it all happens",
  "came for the {topic}, stayed for the {adjective} tangent",
  "doing this for years and never had the words for it",
  "strong disagree but respectfully, the {place} case breaks the rule",
  "second {adjective} thing you have posted this month and both were great",
] as const;

const REPLY_LINES = [
  "fair, though the {adjective} case is different",
  "exactly this",
  "the {place} version runs the other way for me",
  "went back and reread it and you are right",
  "source is a {adjective} forum post from about 2019, which is not a great source",
  "that is the part I keep getting wrong",
  "true for big projects, less true for the {adjective} ones",
  "adding the {animal} to the list of things that ruin a timeline",
  "I do the opposite and regret it weekly",
  "good distinction",
  "not sure I buy it, but I cannot argue it either",
  "the {topic} got much better once we stopped measuring it",
] as const;

const BIOS = [
  "{adjective} {animal} person, mostly here for the {topic} threads",
  "building things, breaking {topic}, posting about the {place}",
  "{place} regular. opinions are my own and often wrong",
  "I make {topic} for a living and still cannot explain it to anyone",
  "mostly lurker. occasionally posts about {adjective} {topic}",
  "here for the {animal} pictures and the {topic} arguments",
  "{adjective} mornings, {place} afternoons",
  "writing a {topic} that refuses to end",
  "collector of {adjective} {animal} photos",
  "ask me about the {place}, I have opinions",
] as const;

const COMMUNITY_ADJECTIVES = [
  "Open",
  "Quiet",
  "Daily",
  "Late",
  "Deep",
  "Small",
  "Bright",
  "Slow",
  "Wide",
  "Plain",
] as const;

const COMMUNITY_SUBJECTS = [
  "Workshop",
  "Corner",
  "Depot",
  "Circle",
  "Collective",
  "Guild",
  "Commons",
  "Room",
  "Union",
  "Field",
] as const;

export interface ContentResult {
  content: string;
  mentionHandles: string[];
  tagNames: string[];
}

// Fills {place} / {topic} / {adjective} / {animal} from the pools above.
function fillTemplate(template: string, rng: Rng, topic: string): string {
  return template
    .replaceAll("{place}", rng.pick(PLACES))
    .replaceAll("{topic}", topic)
    .replaceAll("{adjective}", rng.pick(ADJECTIVES))
    .replaceAll("{animal}", rng.pick(ANIMALS));
}

// A handle mention or a tag, but only sometimes: content that mentions
// someone in every single post stops looking like a feed.
function maybeAppendRelation(
  sentence: string,
  rng: Rng,
  handles: readonly string[],
  tags: readonly string[]
): ContentResult {
  const mentionHandles: string[] = [];
  const tagNames: string[] = [];
  const suffix: string[] = [];
  if (handles.length > 0 && rng.chance(0.18)) {
    const handle = rng.pick(handles);
    mentionHandles.push(handle);
    suffix.push(`cc @${handle}`);
  }
  if (tags.length > 0 && rng.chance(0.3)) {
    const tag = rng.pick(tags);
    tagNames.push(tag);
    suffix.push(`#${tag}`);
  }
  if (suffix.length === 0) {
    return { content: sentence, mentionHandles, tagNames };
  }
  return {
    content: `${sentence}\n\n${suffix.join(" ")}`,
    mentionHandles,
    tagNames,
  };
}

export function generateFleetContent(
  rng: Rng,
  options: { handles: readonly string[]; tags: readonly string[] }
): ContentResult {
  const topic = rng.pick(TOPIC_NOUNS);
  const parts = [
    rng.chance(0.55) ? `${rng.pick(OPENERS)} ` : "",
    fillTemplate(rng.pick(FLEET_BODIES), rng, topic),
    rng.chance(0.35) ? rng.pick(FLEET_CLOSERS) : "",
  ];
  const sentence = parts.join(" ").trim();
  return maybeAppendRelation(sentence, rng, options.handles, options.tags);
}

export function generateGustCaption(rng: Rng): string {
  return fillTemplate(rng.pick(GUST_CAPTIONS), rng, rng.pick(TOPIC_NOUNS));
}

export function generateCommentText(rng: Rng, isReply: boolean): string {
  return fillTemplate(
    rng.pick(isReply ? REPLY_LINES : COMMENT_LINES),
    rng,
    rng.pick(TOPIC_NOUNS)
  );
}

export function generateBio(rng: Rng): string {
  return fillTemplate(rng.pick(BIOS), rng, rng.pick(TOPIC_NOUNS));
}

// A two word handle from the pools, e.g. "quietbadger". The caller appends a
// number for uniqueness, so this only has to be readable, not distinct.
export function generateHandleBase(rng: Rng): string {
  return `${rng.pick(ADJECTIVES)}${rng.pick(ANIMALS)}`;
}

export function generateDisplayName(rng: Rng, handleBase: string): string {
  const capitalized = handleBase.charAt(0).toUpperCase() + handleBase.slice(1);
  return rng.chance(0.25) ? `${capitalized} ${rng.pick(ANIMALS)}` : capitalized;
}

export function generateCommunityName(rng: Rng): string {
  return `${rng.pick(COMMUNITY_ADJECTIVES)} ${rng.pick(COMMUNITY_SUBJECTS)}`;
}

export function generateCommunityDescription(rng: Rng, name: string): string {
  return (
    `${name} is a corner for ${rng.pick(TOPIC_NOUNS)}. ` +
    `Mostly ${rng.pick(PLACES)} talk, occasional ${rng.pick(ANIMALS)} ` +
    `sightings, and long threads nobody reads to the end.`
  );
}

// Handles that read like a real tag: one lowercase word, no punctuation.
export function generateTagName(rng: Rng): string {
  return rng.pick(TOPIC_NOUNS);
}
