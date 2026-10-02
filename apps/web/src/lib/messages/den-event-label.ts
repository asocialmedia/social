// The sentence a membership log line reads as in a den's transcript.
//
// Pure on purpose. The transcript that draws these is five thousand lines deep in
// a component tied to the session, the identity key and the message stream, so it
// does not render in a test; the wording and the "You" substitution are the parts
// that can drift, so they live here where they can be asserted directly.
//
// The product role is "Elder", never the stored "ADMIN". `denRoleLabel` is not
// used here because a log line reads as a sentence rather than as a chip, but the
// word that appears is the same one.
import type { DenMembershipEvent } from "./types";

// How a person is named in a line the reader is part of. The transcript already
// says "You" for the reader's own messages, so a log line that named them by
// handle would be the one place the room addresses them by name.
function nameOf(
  id: string | null,
  name: string | null,
  myUserId: string
): string {
  if (id !== null && id === myUserId) {
    // Lowercase "you", because it is almost always mid-sentence ("Ada made you an
    // Elder"). The actor position capitalises it, since that is the only place it
    // starts the line.
    return "you";
  }
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Someone";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function denEventLine(
  event: DenMembershipEvent,
  myUserId: string
): string {
  const actor = capitalize(nameOf(event.actorId, event.actorName, myUserId));
  const target = nameOf(event.targetUserId, event.targetName, myUserId);
  switch (event.action) {
    case "CREATED": {
      return `${actor} created the den`;
    }
    case "JOINED": {
      // A link join has no author: the actor IS the subject, and the line is the
      // arrival, not an invitation. An add by somebody else names both ends.
      return event.actorId !== null && event.actorId !== event.targetUserId
        ? `${actor} added ${target}`
        : `${target} joined the den`;
    }
    case "LEFT": {
      return `${actor} left the den`;
    }
    case "REMOVED": {
      return `${actor} removed ${target}`;
    }
    case "PROMOTED": {
      return `${actor} made ${target} an Elder`;
    }
    case "DEMOTED": {
      return `${actor} removed ${target} as Elder`;
    }
    case "OWNER_TRANSFERRED": {
      return `${actor} handed the den to ${target}`;
    }
    default: {
      // A new action added server-side reaches an old client as an unknown
      // string. A harmless line is better than a blank row, and this is where the
      // compile error points the day the union grows.
      return `${actor} updated the den`;
    }
  }
}

// Which side of the line the reader is on, so the row can tint the reader's own
// departures and elevations. Not used to change the wording beyond "You".
export function denEventIsAboutMe(
  event: DenMembershipEvent,
  myUserId: string
): boolean {
  return event.actorId === myUserId || event.targetUserId === myUserId;
}
