// ---------------------------------------------------------------------------
// Database access for the Cloudflare Worker / Durable Object
// ---------------------------------------------------------------------------
// Deliberately NOT using Prisma here. Prisma's driver-adapter support for
// Cloudflare Workers (@prisma/adapter-neon) is still preview-stage as of
// writing and has had real bugs (queries hanging under wrangler/Workers).
// @neondatabase/serverless's plain HTTP query function is simpler, more
// battle-tested for exactly this environment, and sufficient for the
// straightforward queries this service needs. Table/column names match
// prisma/schema.prisma exactly (Prisma's default @@map-less naming), so the
// main Next.js app and this Worker read/write the same tables safely.
// ---------------------------------------------------------------------------

import { neon } from '@neondatabase/serverless';

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
  const sql = neon(databaseUrl);

  return {
    async getUserById(id: string): Promise<DbUser | null> {
      const rows = await sql`SELECT id, name, email FROM "User" WHERE id = ${id} LIMIT 1`;
      return (rows[0] as DbUser) ?? null;
    },

    async getUsersByIds(ids: string[]): Promise<DbUser[]> {
      if (ids.length === 0) return [];
      const rows = await sql`SELECT id, name, email FROM "User" WHERE id = ANY(${ids})`;
      return rows as DbUser[];
    },

    async findWallet(userId: string): Promise<DbWallet | null> {
      const rows = await sql`
        SELECT "userId", coins, diamonds, "lifetimeEarned" FROM "Wallet" WHERE "userId" = ${userId} LIMIT 1
      `;
      return (rows[0] as DbWallet) ?? null;
    },

    async decrementWalletCoins(userId: string, amount: number): Promise<void> {
      await sql`
        UPDATE "Wallet" SET coins = coins - ${amount}, "updatedAt" = now() WHERE "userId" = ${userId}
      `;
    },

    async addDiamondsToWallet(userId: string, diamonds: number): Promise<void> {
      // Upsert: create the wallet row if the host somehow doesn't have one yet.
      await sql`
        INSERT INTO "Wallet" (id, "userId", coins, diamonds, "lifetimeEarned", "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, ${userId}, 0, ${diamonds}, ${diamonds}, now(), now())
        ON CONFLICT ("userId") DO UPDATE
          SET diamonds = "Wallet".diamonds + ${diamonds},
              "lifetimeEarned" = "Wallet"."lifetimeEarned" + ${diamonds},
              "updatedAt" = now()
      `;
    },

    async ensureLobbyChat(): Promise<void> {
      await sql`
        INSERT INTO "Chat" (id, name, "isGroup", "createdAt", "updatedAt")
        VALUES ('lobby', 'Valentine Lobby', true, now(), now())
        ON CONFLICT (id) DO NOTHING
      `;
    },

    async findChatMember(chatId: string, userId: string): Promise<boolean> {
      const rows = await sql`
        SELECT id FROM "ChatMember" WHERE "chatId" = ${chatId} AND "userId" = ${userId} LIMIT 1
      `;
      return rows.length > 0;
    },

    async addChatMember(chatId: string, userId: string): Promise<void> {
      await sql`
        INSERT INTO "ChatMember" (id, "chatId", "userId", "joinedAt")
        VALUES (gen_random_uuid()::text, ${chatId}, ${userId}, now())
        ON CONFLICT ("chatId", "userId") DO NOTHING
      `;
    },

    async findChat(chatId: string): Promise<DbChat | null> {
      const rows = await sql`SELECT id, name, "isGroup" FROM "Chat" WHERE id = ${chatId} LIMIT 1`;
      return (rows[0] as DbChat) ?? null;
    },

    async createDmChat(chatId: string, name: string, userAId: string, userBId: string): Promise<void> {
      await sql`
        INSERT INTO "Chat" (id, name, "isGroup", "createdAt", "updatedAt")
        VALUES (${chatId}, ${name}, false, now(), now())
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO "ChatMember" (id, "chatId", "userId", "joinedAt")
        VALUES (gen_random_uuid()::text, ${chatId}, ${userAId}, now()), (gen_random_uuid()::text, ${chatId}, ${userBId}, now())
        ON CONFLICT ("chatId", "userId") DO NOTHING
      `;
    },

    async getChatIdsForUser(userId: string): Promise<string[]> {
      const rows = await sql`SELECT "chatId" FROM "ChatMember" WHERE "userId" = ${userId}`;
      return rows.map((r: any) => r.chatId);
    },

    async getChatMemberIds(chatId: string): Promise<string[]> {
      const rows = await sql`SELECT "userId" FROM "ChatMember" WHERE "chatId" = ${chatId}`;
      return rows.map((r: any) => r.userId);
    },

    async getRecentMessages(chatId: string, take = 100): Promise<DbMessage[]> {
      const rows = await sql`
        SELECT id, "chatId", "senderId", text, "createdAt"
        FROM "Message" WHERE "chatId" = ${chatId}
        ORDER BY "createdAt" ASC
        LIMIT ${take}
      `;
      return (rows as any[]).map(r => ({ ...r, createdAt: new Date(r.createdAt) })) as DbMessage[];
    },

    async createMessage(chatId: string, senderId: string, text: string): Promise<DbMessage> {
      const rows = await sql`
        INSERT INTO "Message" (id, "chatId", "senderId", text, "createdAt")
        VALUES (gen_random_uuid()::text, ${chatId}, ${senderId}, ${text}, now())
        RETURNING id, "chatId", "senderId", text, "createdAt"
      `;
      const r = rows[0] as any;
      return { ...r, createdAt: new Date(r.createdAt) } as DbMessage;
    },

    async createLiveStream(id: string, hostId: string, title: string): Promise<void> {
      await sql`
        INSERT INTO "LiveStream" (id, "hostId", title, status, "createdAt")
        VALUES (${id}, ${hostId}, ${title}, 'active', now())
      `;
    },

    async endLiveStream(id: string): Promise<void> {
      await sql`UPDATE "LiveStream" SET status = 'ended', "endedAt" = now() WHERE id = ${id}`;
    },

    async createLiveComment(streamId: string, userId: string, userName: string, text: string): Promise<void> {
      await sql`
        INSERT INTO "LiveComment" (id, "streamId", "userId", "userName", text, "createdAt")
        VALUES (gen_random_uuid()::text, ${streamId}, ${userId}, ${userName}, ${text}, now())
      `;
    },

    async createLiveGift(
      streamId: string,
      senderId: string,
      senderName: string,
      giftName: string,
      coins: number,
      diamonds: number,
    ): Promise<void> {
      await sql`
        INSERT INTO "LiveGift" (id, "streamId", "senderId", "senderName", "giftName", coins, diamonds, "createdAt")
        VALUES (gen_random_uuid()::text, ${streamId}, ${senderId}, ${senderName}, ${giftName}, ${coins}, ${diamonds}, now())
      `;
    },

    async getRecentStatuses(take = 50): Promise<DbStatus[]> {
      const rows = await sql`
        SELECT id, "userId", "userName", text, "imageUrl", "createdAt"
        FROM "Status" ORDER BY "createdAt" DESC LIMIT ${take}
      `;
      return (rows as any[]).map(r => ({ ...r, createdAt: new Date(r.createdAt) })) as DbStatus[];
    },
  };
}

export type Db = ReturnType<typeof createDb>;
