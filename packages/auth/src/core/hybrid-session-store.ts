import { prisma, redis } from "@asm/db";

export interface HybridSession {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  ipAddress?: string | null;
  lastSyncedAt?: Date;
  syncStatus?: "active" | "archived" | "expired";
  token: string;
  updatedAt: Date;
  userAgent?: string | null;
  userId: string;
}

const REDIS_SESSION_PREFIX = "session:active:";
const REDIS_USER_SESSIONS_PREFIX = "user:sessions:";

const SESSION_TTL = 60 * 60 * 24 * 7;

export class HybridSessionStore {
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly syncIntervalMs = 5 * 60 * 1000;

  constructor() {
    this.startPeriodicSync();
  }

  private get redis() {
    return redis;
  }

  async create(
    session: Omit<HybridSession, "id" | "createdAt" | "updatedAt">
  ): Promise<HybridSession> {
    const now = new Date();
    const fullSession: HybridSession = {
      id: crypto.randomUUID(),
      ...session,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: now,
      syncStatus: "active",
    };

    try {
      await this.storeInRedis(fullSession);

      await this.storeInPostgreSQL(fullSession);

      console.log(`Created session ${fullSession.id} in hybrid store`);
      return fullSession;
    } catch (error) {
      console.error("Failed to create session in hybrid store:", error);

      try {
        const dbSession = await this.storeInPostgreSQL(fullSession);
        console.log(
          `Fallback: Created session ${fullSession.id} in PostgreSQL only`
        );
        return dbSession;
      } catch (dbError) {
        console.error(
          "Failed to create session in PostgreSQL fallback:",
          dbError
        );
        throw error;
      }
    }
  }

  async findByToken(token: string): Promise<HybridSession | null> {
    try {
      const redisSession = await this.getFromRedis(token);
      if (redisSession) {
        if (redisSession.expiresAt > new Date()) {
          return redisSession;
        }

        await this.delete(token);
        return null;
      }
    } catch (error) {
      console.warn("Redis lookup failed, falling back to PostgreSQL:", error);
    }

    try {
      const dbSession = await prisma.session.findUnique({
        where: { token },
      });

      if (dbSession) {
        const session = this.mapDbSessionToHybridSession(dbSession);

        if (session.expiresAt > new Date()) {
          await this.storeInRedis(session);
          return session;
        }

        await this.delete(token);
        return null;
      }
    } catch (error) {
      console.error("PostgreSQL session lookup failed:", error);
    }

    return null;
  }

  async findByUserId(userId: string): Promise<HybridSession[]> {
    const sessions: HybridSession[] = [];

    try {
      const redisSessions = await this.getUserSessionsFromRedis(userId);
      sessions.push(...redisSessions);
    } catch (error) {
      console.warn("Redis user sessions lookup failed:", error);
    }

    try {
      const dbSessions = await prisma.session.findMany({
        where: { userId },
      });

      const redisTokens = new Set(sessions.map((s) => s.token));
      const additionalSessions = dbSessions
        .filter((dbSession) => !redisTokens.has(dbSession.token))
        .map((dbSession) => this.mapDbSessionToHybridSession(dbSession));

      sessions.push(...additionalSessions);
    } catch (error) {
      console.error("PostgreSQL user sessions lookup failed:", error);
    }

    return sessions.filter((session) => session.expiresAt > new Date());
  }

  async update(
    id: string,
    updates: Partial<HybridSession>
  ): Promise<HybridSession | null> {
    try {
      const redisSession = await this.updateInRedis(id, updates);
      if (redisSession) {
        await this.updateInPostgreSQL(id, updates);
        return redisSession;
      }
    } catch (error) {
      console.warn("Redis session update failed:", error);
    }

    try {
      const updatedDbSession = await this.updateInPostgreSQL(id, updates);
      if (updatedDbSession) {
        try {
          await this.storeInRedis(updatedDbSession);
        } catch {
          // Ignore Redis store errors
        }
        return updatedDbSession;
      }
    } catch (error) {
      console.error("PostgreSQL session update failed:", error);
    }

    return null;
  }

  async delete(token: string): Promise<void> {
    try {
      await this.deleteFromRedis(token);
    } catch (error) {
      console.warn("Redis session deletion failed:", error);
    }

    try {
      await prisma.session.deleteMany({
        where: { token },
      });
    } catch (error) {
      console.error("PostgreSQL session deletion failed:", error);
    }
  }

  async deleteByUserId(userId: string): Promise<void> {
    try {
      await this.deleteUserSessionsFromRedis(userId);
    } catch (error) {
      console.warn("Redis user sessions deletion failed:", error);
    }

    try {
      await prisma.session.deleteMany({
        where: { userId },
      });
    } catch (error) {
      console.error("PostgreSQL user sessions deletion failed:", error);
    }
  }

  private startPeriodicSync(): void {
    this.syncInterval = setInterval(async () => {
      await this.syncExpiredSessions();
    }, this.syncIntervalMs);
  }

  private async syncExpiredSessions(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${REDIS_SESSION_PREFIX}*`);

      await Promise.all(
        keys.map(async (key) => {
          const token = key.replace(REDIS_SESSION_PREFIX, "");
          const session = await this.getFromRedis(token);

          if (session && session.expiresAt <= new Date()) {
            await this.updateInPostgreSQL(session.id, {
              syncStatus: "expired",
              lastSyncedAt: new Date(),
            });

            await this.deleteFromRedis(token);
            console.log(`Archived expired session ${session.id} to PostgreSQL`);
          }
        })
      );
    } catch (error) {
      console.error("Session sync failed:", error);
    }
  }

  private async storeInRedis(session: HybridSession): Promise<void> {
    const key = `${REDIS_SESSION_PREFIX}${session.token}`;
    const userSessionsKey = `${REDIS_USER_SESSIONS_PREFIX}${session.userId}`;

    const pipeline = this.redis.pipeline();

    pipeline.setex(key, SESSION_TTL, JSON.stringify(session));

    pipeline.sadd(userSessionsKey, session.token);

    await pipeline.exec();
  }

  private async getFromRedis(token: string): Promise<HybridSession | null> {
    const key = `${REDIS_SESSION_PREFIX}${token}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    const session = JSON.parse(data);

    session.expiresAt = new Date(session.expiresAt);
    session.createdAt = new Date(session.createdAt);
    session.updatedAt = new Date(session.updatedAt);
    if (session.lastSyncedAt) {
      session.lastSyncedAt = new Date(session.lastSyncedAt);
    }

    return session;
  }

  private async updateInRedis(
    id: string,
    updates: Partial<HybridSession>
  ): Promise<HybridSession | null> {
    const keys = await this.redis.keys(`${REDIS_SESSION_PREFIX}*`);

    const sessions = await Promise.all(
      keys.map(async (key) =>
        this.getFromRedis(key.replace(REDIS_SESSION_PREFIX, ""))
      )
    );

    const session = sessions.find((s) => s && s.id === id) ?? null;
    if (session) {
      const updatedSession = {
        ...session,
        ...updates,
        updatedAt: new Date(),
      };
      await this.storeInRedis(updatedSession);
      return updatedSession;
    }

    return null;
  }

  private async deleteFromRedis(token: string): Promise<void> {
    const key = `${REDIS_SESSION_PREFIX}${token}`;

    const session = await this.getFromRedis(token);
    if (session) {
      const userSessionsKey = `${REDIS_USER_SESSIONS_PREFIX}${session.userId}`;
      const pipeline = this.redis.pipeline();
      pipeline.del(key);
      pipeline.srem(userSessionsKey, token);
      await pipeline.exec();
    } else {
      await this.redis.del(key);
    }
  }

  private async getUserSessionsFromRedis(
    userId: string
  ): Promise<HybridSession[]> {
    const userSessionsKey = `${REDIS_USER_SESSIONS_PREFIX}${userId}`;
    const tokens = await this.redis.smembers(userSessionsKey);

    const sessions = await Promise.all(
      tokens.map(async (token) => this.getFromRedis(token))
    );

    return sessions.filter(
      (session): session is HybridSession => session !== null
    );
  }

  private async deleteUserSessionsFromRedis(userId: string): Promise<void> {
    const userSessionsKey = `${REDIS_USER_SESSIONS_PREFIX}${userId}`;
    const tokens = await this.redis.smembers(userSessionsKey);

    if (tokens.length > 0) {
      const pipeline = this.redis.pipeline();
      pipeline.del(userSessionsKey);
      for (const token of tokens) {
        pipeline.del(`${REDIS_SESSION_PREFIX}${token}`);
      }
      await pipeline.exec();
    }
  }

  private async storeInPostgreSQL(
    session: HybridSession
  ): Promise<HybridSession> {
    const dbSession = await prisma.session.create({
      data: {
        id: session.id,
        userId: session.userId,
        token: session.token,
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      },
    });

    return this.mapDbSessionToHybridSession(dbSession);
  }

  private async updateInPostgreSQL(
    id: string,
    updates: Partial<HybridSession>
  ): Promise<HybridSession | null> {
    try {
      const dbSession = await prisma.session.update({
        where: { id },
        data: {
          ...(updates.token && { token: updates.token }),
          ...(updates.expiresAt && { expiresAt: updates.expiresAt }),
          ...(updates.ipAddress !== undefined && {
            ipAddress: updates.ipAddress,
          }),
          ...(updates.userAgent !== undefined && {
            userAgent: updates.userAgent,
          }),
          updatedAt: new Date(),
        },
      });

      return this.mapDbSessionToHybridSession(dbSession);
    } catch {
      return null;
    }
  }

  private mapDbSessionToHybridSession(dbSession: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): HybridSession {
    return {
      id: dbSession.id,
      userId: dbSession.userId,
      token: dbSession.token,
      expiresAt: dbSession.expiresAt,
      ipAddress: dbSession.ipAddress,
      userAgent: dbSession.userAgent,
      createdAt: dbSession.createdAt,
      updatedAt: dbSession.updatedAt,
      lastSyncedAt: dbSession.updatedAt,
      syncStatus: "active",
    };
  }

  destroy(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}

export const hybridSessionStore = new HybridSessionStore();
