// ---------------------------------------------------------------------------
// Database access for the local Node realtime service.
// Port of mini-services/cloudflare-ws/src/db.ts from the Neon serverless
// driver to plain `pg` — identical SQL, identical table/column names, so the
// Next.js app and this service read/write the same tables safely.
// ---------------------------------------------------------------------------

import { Pool } from 'pg';

export interface DbUser {
  id: string;
  name: string;
  email: string;
}

export interface DbWallet {
  userId: string;
  coins: number;
  diamonds: number;
  lifetimeEarned: number;
}

export interface DbChat {
  id: string;
  name: string;
  isGroup: boolean;
}

export interface DbMessage {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  createdAt: Date;
}

export interface DbStatus {
  id: string;
  userId: string;
  userName: string;
  text: string;
  imageUrl: string | null;
  createdAt: Date;
}

export function createDb(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });

  async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
    const res = await pool.query(text, params);
    return res.rows as T[];
  }

  return {
    async getUserById(id: string): Promise<DbUser | null> {
      const rows = await q(`SELECT id, name, email FROM "User" WHERE id = $1 LIMIT 1`, [id]);
      return (rows[0] as DbUser) ?? null;
    },

    async getUsersByIds(ids: string[]): Promise<DbUser[]> {
      if (ids.length === 0) return [];
      return q(`SELECT id, name, email FROM "User" WHERE id = ANY($1)`, [ids]);
    },

    async findWallet(userId: string): Promise<DbWallet | null> {
      const rows = await q(
        `SELECT "userId", coins, diamonds, "lifetimeEarned" FROM "Wallet" WHERE "userId" = $1 LIMIT 1`,
        [userId],
      );
      return (rows[0] as DbWallet) ?? null;
    },

    async decrementWalletCoins(userId: string, amount: number): Promise<void> {
      await q(
        `UPDATE "Wallet" SET coins = coins - $1, "updatedAt" = now() WHERE "userId" = $2`,
        [amount, userId],
      );
    },

    async addDiamondsToWallet(userId: string, diamonds: number): Promise<void> {
      // Upsert: create the wallet row if the host somehow doesn't have one yet.
      await q(
        `INSERT INTO "Wallet" (id, "userId", coins, diamonds, "lifetimeEarned", "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, 0, $2, $2, now(), now())
         ON CONFLICT ("userId") DO UPDATE
           SET diamonds = "Wallet".diamonds + $2,
               "lifetimeEarned" = "Wallet"."lifetimeEarned" + $2,
               "updatedAt" = now()`,
        [userId, diamonds],
      );
    },

    async ensureLobbyChat(): Promise<void> {
      await q(
        `INSERT INTO "Chat" (id, name, "isGroup", "createdAt", "updatedAt")
         VALUES ('lobby', 'Valentine Lobby', true, now(), now())
         ON CONFLICT (id) DO NOTHING`,
      );
    },

    async findChatMember(chatId: string, userId: string): Promise<boolean> {
      const rows = await q(
        `SELECT id FROM "ChatMember" WHERE "chatId" = $1 AND "userId" = $2 LIMIT 1`,
        [chatId, userId],
      );
      return rows.length > 0;
    },

    async addChatMember(chatId: string, userId: string): Promise<void> {
      await q(
        `INSERT INTO "ChatMember" (id, "chatId", "userId", "joinedAt")
         VALUES (gen_random_uuid()::text, $1, $2, now())
         ON CONFLICT ("chatId", "userId") DO NOTHING`,
        [chatId, userId],
      );
    },

    async findChat(chatId: string): Promise<DbChat | null> {
      const rows = await q(`SELECT id, name, "isGroup" FROM "Chat" WHERE id = $1`, [chatId]);
      return (rows[0] as DbChat) ?? null;
    },

    async createDmChat(chatId: string, name: string, userAId: string, userBId: string): Promise<void> {
      await q(
        `INSERT INTO "Chat" (id, name, "isGroup", "createdAt", "updatedAt")
         VALUES ($1, $2, false, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [chatId, name],
      );
      await q(
        `INSERT INTO "ChatMember" (id, "chatId", "userId", "joinedAt")
         VALUES (gen_random_uuid()::text, $1, $2, now()), (gen_random_uuid()::text, $1, $3, now())
         ON CONFLICT ("chatId", "userId") DO NOTHING`,
        [chatId, userAId, userBId],
      );
    },

    async getChatIdsForUser(userId: string): Promise<string[]> {
      const rows = await q(`SELECT "chatId" FROM "ChatMember" WHERE "userId" = $1`, [userId]);
      return rows.map((r: any) => r.chatId);
    },

    async getChatMemberIds(chatId: string): Promise<string[]> {
      const rows = await q(`SELECT "userId" FROM "ChatMember" WHERE "chatId" = $1`, [chatId]);
      return rows.map((r: any) => r.userId);
    },

    async getRecentMessages(chatId: string, take = 100): Promise<DbMessage[]> {
      const rows = await q(
        `SELECT id, "chatId", "senderId", text, "createdAt"
         FROM "Message" WHERE "chatId" = $1
         ORDER BY "createdAt" ASC
         LIMIT $2`,
        [chatId, take],
      );
      return (rows as any[]).map((r) => ({ ...r, createdAt: new Date(r.createdAt) })) as DbMessage[];
    },

    async createMessage(chatId: string, senderId: string, text: string): Promise<DbMessage> {
      const rows = await q(
        `INSERT INTO "Message" (id, "chatId", "senderId", text, "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, now())
         RETURNING id, "chatId", "senderId", text, "createdAt"`,
        [chatId, senderId, text],
      );
      const r = rows[0] as any;
      return { ...r, createdAt: new Date(r.createdAt) } as DbMessage;
    },

    async createLiveStream(id: string, hostId: string, title: string): Promise<void> {
      await q(
        `INSERT INTO "LiveStream" (id, "hostId", title, status, "createdAt")
         VALUES ($1, $2, $3, 'active', now())`,
        [id, hostId, title],
      );
    },

    async endLiveStream(id: string): Promise<void> {
      await q(`UPDATE "LiveStream" SET status = 'ended', "endedAt" = now() WHERE id = $1`, [id]);
    },

    async createLiveComment(streamId: string, userId: string, userName: string, text: string): Promise<void> {
      await q(
        `INSERT INTO "LiveComment" (id, "streamId", "userId", "userName", text, "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, now())`,
        [streamId, userId, userName, text],
      );
    },

    async createLiveGift(
      streamId: string,
      senderId: string,
      senderName: string,
      giftName: string,
      coins: number,
      diamonds: number,
    ): Promise<void> {
      await q(
        `INSERT INTO "LiveGift" (id, "streamId", "senderId", "senderName", "giftName", coins, diamonds, "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, now())`,
        [streamId, senderId, senderName, giftName, coins, diamonds],
      );
    },

    async getRecentStatuses(take = 50): Promise<DbStatus[]> {
      const rows = await q(
        `SELECT id, "userId", "userName", text, "imageUrl", "createdAt"
         FROM "Status" ORDER BY "createdAt" DESC LIMIT $1`,
        [take],
      );
      return (rows as any[]).map((r) => ({ ...r, createdAt: new Date(r.createdAt) })) as DbStatus[];
    },

    async getSubscribers(): Promise<Array<{ email: string; name: string | null }>> {
      return q(`SELECT email, name FROM "Subscriber"`);
    },
  };
}

export type Db = ReturnType<typeof createDb>;
