import { randomUUID } from "node:crypto";

import { and } from "@prisma/orm-postgres/orm-client";

import prisma, { toPrismaDateTime } from "../prisma";

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

export async function savePushSubscription(
  input: PushSubscriptionInput
): Promise<void> {
  const { auth, endpoint, p256dh, userAgent, userId } = input;
  const now = toPrismaDateTime(new Date());
  await prisma.orm.public.PushSubscriptions.upsert({
    conflictOn: { endpoint },
    create: {
      auth,
      endpoint,
      id: randomUUID(),
      p256dh,
      userAgent: userAgent ?? null,
      userId,
    },
    update: {
      auth,
      p256dh,
      updatedAt: now,
      userAgent: userAgent ?? null,
      userId,
    },
  });
}

export async function removePushSubscription(
  endpoint: string,
  userId?: string
): Promise<void> {
  await prisma.orm.public.PushSubscriptions.where((subscription) =>
    userId
      ? and(subscription.endpoint.eq(endpoint), subscription.userId.eq(userId))
      : subscription.endpoint.eq(endpoint)
  ).deleteAndCount();
}

export async function listPushSubscriptions(
  userId: string
): Promise<StoredPushSubscription[]> {
  const subscriptions = await prisma.orm.public.PushSubscriptions.select(
    "auth",
    "endpoint",
    "id",
    "p256dh"
  )
    .where({ userId })
    .orderBy((subscription) => subscription.createdAt.desc())
    .all();
  return subscriptions;
}

export async function prunePushSubscriptions(
  endpoints: string[]
): Promise<void> {
  if (endpoints.length === 0) {
    return;
  }
  await prisma.orm.public.PushSubscriptions.where((subscription) =>
    subscription.endpoint.in(endpoints)
  ).deleteAndCount();
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

export async function saveDevicePushToken(
  input: DevicePushTokenInput
): Promise<void> {
  const { platform, provider = "fcm", token, userId } = input;
  const now = toPrismaDateTime(new Date());
  await prisma.orm.public.DevicePushTokens.upsert({
    conflictOn: { token },
    create: {
      id: randomUUID(),
      platform,
      provider,
      token,
      userId,
    },
    update: {
      platform,
      provider,
      updatedAt: now,
      userId,
    },
  });
}

export async function removeDevicePushToken(
  token: string,
  userId?: string
): Promise<void> {
  await prisma.orm.public.DevicePushTokens.where((device) =>
    userId
      ? and(device.token.eq(token), device.userId.eq(userId))
      : device.token.eq(token)
  ).deleteAndCount();
}

export async function listDevicePushTokens(
  userId: string
): Promise<StoredDevicePushToken[]> {
  const tokens = await prisma.orm.public.DevicePushTokens.select(
    "id",
    "platform",
    "provider",
    "token"
  )
    .where({ userId })
    .orderBy((device) => device.createdAt.desc())
    .all();
  return tokens;
}

export async function pruneDevicePushTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) {
    return;
  }
  await prisma.orm.public.DevicePushTokens.where((device) =>
    device.token.in(tokens)
  ).deleteAndCount();
}

export async function clearUserPushRegistrations(
  userId: string
): Promise<void> {
  await Promise.all([
    prisma.orm.public.PushSubscriptions.where({ userId }).deleteAndCount(),
    prisma.orm.public.DevicePushTokens.where({ userId }).deleteAndCount(),
  ]);
}
