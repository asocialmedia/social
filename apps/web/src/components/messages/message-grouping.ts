import { format, isSameDay, isSameYear, subDays } from "date-fns";

// Message grouping and timestamp policy for 1:1 chats, kept pure so the rules
// are unit-tested independently of rendering and the virtualizer.
//
// Grouping is what makes a run of messages read as one block: consecutive
// messages from the same sender within GROUP_WINDOW_MS share a tight spacing,
// a single avatar (on the group's last row), and one tail on the final bubble.
// A time divider only appears when the conversation actually pauses for a
// while, so a fast back-and-forth never gets stamped per message.

// Consecutive messages from the same sender within this window group together.
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

// A visible time divider is inserted when this much time passes between
// messages (or before the first message of the transcript).
export const TIME_DIVIDER_MS = 15 * 60 * 1000;

export interface MessageGroupMeta {
  // First row of its group: no tight spacing above, full top rounding.
  isFirstInGroup: boolean;
  // Last row of its group: tight spacing below, avatar + bubble tail live here.
  isLastInGroup: boolean;
  // Render a time divider above this row.
  showTimeDivider: boolean;
}

export interface GroupableMessage {
  createdAt: Date | string;
  senderId: string;
}

// Parses a Date or a JSON ISO string to epoch millis, or null when the value is
// missing/unparseable. Rows fetched over JSON carry strings; the realtime
// stream revives them to Date. A null result fails safe below (own group, no
// divider) rather than producing a bogus gap.
function toTime(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

// Whether the later message continues the group started by the earlier one:
// same sender and a forward gap inside the window. Missing either endpoint
// (start/end of the list) ends the group. A negative gap (clock skew / bad
// data) does NOT continue the group, so a malformed pair degrades to separate
// groups rather than rendering a bogus tight stack.
function continuesGroup(
  earlier: GroupableMessage | undefined,
  later: GroupableMessage | undefined,
  earlierTime: number | null,
  laterTime: number | null
): boolean {
  if (!earlier || !later) {
    return false;
  }
  if (earlier.senderId !== later.senderId) {
    return false;
  }
  if (earlierTime === null || laterTime === null) {
    return false;
  }
  const gap = laterTime - earlierTime;
  return gap >= 0 && gap <= GROUP_WINDOW_MS;
}

// Computes the grouping metadata for one message in transcript order.
export function getMessageGroupMeta(
  messages: GroupableMessage[],
  index: number
): MessageGroupMeta {
  const current = messages[index];
  if (!current) {
    // Out-of-range index (a stale virtual item during a trim): render a
    // self-contained row rather than throwing.
    return {
      isFirstInGroup: true,
      isLastInGroup: true,
      showTimeDivider: false,
    };
  }

  const previous = index > 0 ? messages[index - 1] : undefined;
  const next = index < messages.length - 1 ? messages[index + 1] : undefined;

  const currentTime = toTime(current.createdAt);
  const previousTime = previous ? toTime(previous.createdAt) : null;
  const nextTime = next ? toTime(next.createdAt) : null;

  const isFirstInGroup = !continuesGroup(
    previous,
    current,
    previousTime,
    currentTime
  );
  const isLastInGroup = !continuesGroup(current, next, currentTime, nextTime);

  // The first message always anchors the timeline. Otherwise a divider appears
  // once the gap from the previous message exceeds the divider window.
  const gapFromPrevious =
    currentTime === null || previousTime === null
      ? null
      : currentTime - previousTime;
  const showTimeDivider =
    index === 0 ||
    (gapFromPrevious !== null && gapFromPrevious > TIME_DIVIDER_MS);

  return { isFirstInGroup, isLastInGroup, showTimeDivider };
}

// Human label for a time divider: bare time for today, "Yesterday" for the day
// before, and a date prefix beyond that. `now` is injectable so the labels are
// deterministic in tests. Returns null for an unparseable timestamp so the
// caller can skip the divider entirely instead of rendering "Invalid Date".
export function formatTimeDivider(
  value: Date | string | null | undefined,
  now: Date = new Date()
): string | null {
  const time = toTime(value);
  if (time === null) {
    return null;
  }
  const date = new Date(time);
  const timeLabel = format(date, "h:mm a");
  if (isSameDay(date, now)) {
    return timeLabel;
  }
  if (isSameDay(date, subDays(now, 1))) {
    return `Yesterday ${timeLabel}`;
  }
  if (isSameYear(date, now)) {
    return `${format(date, "MMM d")}, ${timeLabel}`;
  }
  return `${format(date, "MMM d, yyyy")}, ${timeLabel}`;
}
