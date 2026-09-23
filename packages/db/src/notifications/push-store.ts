// Push delivery storage: browser push subscriptions and native device tokens.
//
// Kept beside the notification queue helpers (queue.ts) because they share the
// same lifecycle: a notification row is created, a queue job bumps the unread
// counter, and the same job fans the notification out to every registered
// endpoint for that recipient. Delivery itself lives in @asm/notifications,
// which never imports this module - the worker wires the two together.

import prisma from "../prisma";

export interface PushSubscriptionInput {
  auth: string;
  endpoint: string;
  p256dh: string;
  userAgent?: string | null;
  userId: string;
}

export interface StoredPushSubscription {
  auth: string;
  endpoint: string;
  id: string;
  p256dh: string;
}

// Registers (or refreshes) a browser push subscription for a user.
export async function savePushSubscription(
  input: PushSubscriptionInput
): Promise<void> {
  const { auth, endpoint, p256dh, userAgent, userId } = input;
  await prisma.pushSubscription.upsert({
    create: { auth, endpoint, p256dh, userAgent: userAgent ?? null, userId },
    update: { auth, p256dh, userAgent: userAgent ?? null, userId },
    where: { endpoint },
  });
}

// Removes a browser subscription by endpoint. Idempotent.
export async function removePushSubscription(
  endpoint: string,
  userId?: string
): Promise<void> {
  await prisma.pushSubscription.deleteMany({
    where: userId ? { endpoint, userId } : { endpoint },
  });
}

// Every browser subscription registered for a user.
export function listPushSubscriptions(
  userId: string
): Promise<StoredPushSubscription[]> {
  return prisma.pushSubscription.findMany({
    orderBy: { createdAt: "desc" },
    select: { auth: true, endpoint: true, id: true, p256dh: true },
    where: { userId },
  });
}

// Removes subscriptions the push service reported as gone (HTTP 404/410).
// Called after a delivery pass so a dead browser registration self-heals.
export async function prunePushSubscriptions(
  endpoints: string[]
): Promise<void> {
  if (endpoints.length === 0) {
    return;
  }
  await prisma.pushSubscription.deleteMany({
    where: { endpoint: { in: endpoints } },
  });
}

export interface DevicePushTokenInput {
  platform: string;
  provider?: string;
  token: string;
  userId: string;
}

export interface StoredDevicePushToken {
  id: string;
  platform: string;
  provider: string;
  token: string;
}

// Registers a native device token. The token is unique globally: upserting it
// moves it to the current user, so a shared device that switches accounts stops
// notifying the previous one.
export async function saveDevicePushToken(
  input: DevicePushTokenInput
): Promise<void> {
  const { platform, provider = "fcm", token, userId } = input;
  await prisma.devicePushToken.upsert({
    create: { platform, provider, token, userId },
    update: { platform, provider, userId },
    where: { token },
  });
}

// Removes a native device token by value. Idempotent.
export async function removeDevicePushToken(
  token: string,
  userId?: string
): Promise<void> {
  await prisma.devicePushToken.deleteMany({
    where: userId ? { token, userId } : { token },
  });
}

// Every native device token registered for a user.
export function listDevicePushTokens(
  userId: string
): Promise<StoredDevicePushToken[]> {
  return prisma.devicePushToken.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, platform: true, provider: true, token: true },
    where: { userId },
  });
}

// Removes device tokens the push service reported as unregistered. Called after
// a delivery pass so an uninstalled app self-heals.
export async function pruneDevicePushTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) {
    return;
  }
  await prisma.devicePushToken.deleteMany({
    where: { token: { in: tokens } },
  });
}

// Drops every registration for a user (sign-out on every device).
export async function clearUserPushRegistrations(
  userId: string
): Promise<void> {
  await Promise.all([
    prisma.pushSubscription.deleteMany({ where: { userId } }),
    prisma.devicePushToken.deleteMany({ where: { userId } }),
  ]);
}
