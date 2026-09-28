// Notification queue events deferred until the transaction that wrote the
// notification rows has committed.
//
// Enqueueing inside the transaction raced the worker: the job could run
// before the commit, look the row up, find nothing, treat it as deleted and
// silently drop the push. Serializable transactions also retry their
// callback, so an enqueue inside could fire once per attempt. Collect the
// events while the transaction runs (reset at the top of the callback, so a
// retry starts clean) and flush once it has resolved.
import { setTimeout as sleep } from "node:timers/promises";

import {
  enqueueNotificationCreated,
  enqueueNotificationDeleted,
} from "@asm/db";

export interface NotificationEvents {
  created: { notificationId: string; recipientId: string }[];
  deleted: string[];
}

export function newNotificationEvents(): NotificationEvents {
  return { created: [], deleted: [] };
}

const ENQUEUE_MAX_ATTEMPTS = 3;

async function enqueueWithRetry(
  action: () => Promise<void>,
  attempt = 1
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (attempt >= ENQUEUE_MAX_ATTEMPTS) {
      throw error;
    }
    await sleep(100 * 2 ** (attempt - 1));
    await enqueueWithRetry(action, attempt + 1);
  }
}

export function resetNotificationEvents(events: NotificationEvents): void {
  events.created.length = 0;
  events.deleted.length = 0;
}

async function enqueueCreatedSafely(
  recipientId: string,
  notificationId: string,
  label: string
): Promise<void> {
  try {
    await enqueueWithRetry(() =>
      enqueueNotificationCreated(recipientId, notificationId)
    );
  } catch (error) {
    console.error(`Failed to enqueue ${label} notification event:`, error);
  }
}

async function enqueueDeletedSafely(
  recipientId: string,
  label: string
): Promise<void> {
  try {
    await enqueueWithRetry(() => enqueueNotificationDeleted(recipientId));
  } catch (error) {
    console.error(
      `Failed to enqueue ${label} notification removal event:`,
      error
    );
  }
}

// Fire-and-forget: a failed enqueue only costs the unread counter/push for
// that event, never the request that produced it.
export function flushNotificationEvents(
  events: NotificationEvents,
  label: string
): void {
  for (const { notificationId, recipientId } of events.created) {
    void enqueueCreatedSafely(recipientId, notificationId, label);
  }
  for (const recipientId of events.deleted) {
    void enqueueDeletedSafely(recipientId, label);
  }
  resetNotificationEvents(events);
}
