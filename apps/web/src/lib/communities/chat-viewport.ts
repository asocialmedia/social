export interface CommunityChatViewportAnchor {
  messageId: string;
  offset: number;
}

export function captureCommunityChatAnchor(
  container: HTMLElement
): CommunityChatViewportAnchor | null {
  const { top } = container.getBoundingClientRect();
  const row = [
    ...container.querySelectorAll<HTMLElement>("[data-chat-message-id]"),
  ].find((element) => element.getBoundingClientRect().bottom > top);
  return row?.dataset.chatMessageId
    ? {
        messageId: row.dataset.chatMessageId,
        offset: row.getBoundingClientRect().top - top,
      }
    : null;
}

export function restoreCommunityChatAnchor(
  container: HTMLElement,
  anchor: CommunityChatViewportAnchor
): void {
  const row = [
    ...container.querySelectorAll<HTMLElement>("[data-chat-message-id]"),
  ].find((element) => element.dataset.chatMessageId === anchor.messageId);
  if (row) {
    container.scrollTop +=
      row.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      anchor.offset;
  }
}

export function centerCommunityChatMessage(
  container: HTMLElement,
  messageId: string
): void {
  const row = [
    ...container.querySelectorAll<HTMLElement>("[data-chat-message-id]"),
  ].find((element) => element.dataset.chatMessageId === messageId);
  if (row) {
    const bounds = row.getBoundingClientRect();
    container.scrollTop +=
      bounds.top -
      container.getBoundingClientRect().top -
      (container.clientHeight - bounds.height) / 2;
  }
}
