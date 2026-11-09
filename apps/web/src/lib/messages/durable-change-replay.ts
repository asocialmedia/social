// Durable change replay lives in @asm/messages so web and native replay a
// conversation's missed edits, deletes and reactions through one cursor loop.
export {
  MAX_MESSAGE_CHANGE_REPLAY_PAGES,
  MESSAGE_CHANGE_PAGE_SIZE,
  applyChangesBeforeCursorCommit,
  messageChangeCursorStorageKey,
  parseDurableMessageChangePage,
  readMessageChangeCursor,
  replayDurableMessageChanges,
  writeMessageChangeCursor,
} from "@asm/messages";
export type {
  DurableMessageChange,
  DurableMessageChangePage,
  DurableMessageChangeReplay,
  DurableMessageChangeStorage,
  FetchDurableMessageChangePage,
} from "@asm/messages";
