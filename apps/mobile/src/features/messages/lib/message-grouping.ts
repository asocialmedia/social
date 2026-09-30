// Message grouping and timestamp policy for 1:1 chats, ported from web's
// components/messages/message-grouping.ts. Kept pure so the rules are unit-tested
// independently of rendering and the list.
//
// Grouping is what makes a run of messages read as one block: consecutive messages
// from the same sender within GROUP_WINDOW_MS share a tight spacing, a single
// avatar (on the group's last row), and one tail on the final bubble. A time
// divider only appears when the conversation actually pauses for a while, so a
// fast back-and-forth never gets stamped per message.
//
// date-fns is not a dependency here, so the formatter is hand-rolled. It takes a
// clock so the labels are deterministic in tests and correct across locales
// without pulling Intl formatting differences into the transcript.

export const GROUP_WINDOW_MS = 5 * 60 * 1000;
export const TIME_DIVIDER_MS = 15 * 60 * 1000;

export interface MessageGroupMeta {
  // First row of its group: no tight spacing above, full top rounding.
  isFirstInGroup: boolean;
  // Last row of its group: tight spacing below, avatar + bubble tail live here.
  isLastInGroup: boolean;
  showTimeDivider: boolean;
}

export interface GroupableMessage {
  createdAt: Date | string;
  senderId: string;
}

function toTime(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

// Whether the later message continues the group started by the earlier one: same
// sender and a forward gap inside the window. Missing either endpoint ends the
// group. A negative gap (clock skew / bad data) does NOT continue the group, so a
// malformed pair degrades to separate groups rather than a bogus tight stack.
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
//
// `messages` is the loaded window, and `index` indexes into it. When a thread has
// paged older rows in, `index === 0` is the oldest LOADED row, not the first
// message ever sent, so a divider appears there: the transcript did in fact pause
// at that boundary from the reader's point of view.
export function getMessageGroupMeta(
  messages: GroupableMessage[],
  index: number
): MessageGroupMeta {
  const current = messages[index];
  if (!current) {
    // Out-of-range index (a stale row during a trim): render a self-contained row
    // rather than throwing.
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
// deterministic in tests. Returns null for an unparseable timestamp so the caller
// can skip the divider instead of rendering "Invalid Date".
export function formatTimeDivider(
  value: Date | string | null | undefined,
  now: Date = new Date()
): string | null {
  const time = toTime(value);
  if (time === null) {
    return null;
  }
  const date = new Date(time);
  const timeLabel = formatClockTime(date);
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1
  );
  if (isSameDay(date, now)) {
    return timeLabel;
  }
  if (isSameDay(date, yesterday)) {
    return `Yesterday ${timeLabel}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${timeLabel}`;
  }
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}, ${timeLabel}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

// Matches date-fns' `h:mm a`: 12-hour clock, no leading zero on the hour, minutes
// always two digits. Midnight is "12:00 AM", not "0:00 AM".
export function formatClockTime(date: Date): string {
  const hours = date.getHours();
  const hours12 = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

// The one-line timestamp on a list row: bare time today, "Yesterday", then a
// date. `now` is injectable for the same reason.
export function formatListTimestamp(
  value: Date | string | null | undefined,
  now: Date = new Date()
): string {
  const time = toTime(value);
  if (time === null) {
    return "";
  }
  const date = new Date(time);
  const clock = formatClockTime(date);
  if (isSameDay(date, now)) {
    return clock;
  }
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1
  );
  if (isSameDay(date, yesterday)) {
    return "Yesterday";
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  }
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

// A relative stamp for a receipt line ("Read 3:04 PM"), falling back to the plain
// clock when the stamp is today or yesterday.
export function formatReceiptStamp(
  at: number | null,
  now: Date = new Date()
): string {
  if (at === null) {
    return "";
  }
  return formatListTimestamp(new Date(at), now);
}

// Unread count as a badge string: an exact number up to 99, then a cap. The nav
// badge and the list row use the same shape so they cannot disagree.
export function formatArrivalCount(count: number): string {
  if (count <= 0) {
    return "";
  }
  return count > 99 ? "99+" : String(count);
}
