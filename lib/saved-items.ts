import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPlanForUser, planForSubscription, type SubscriptionUser } from "@/lib/billing";
import type { SavedErrorCode, SavedState, SavedSnapshot } from "@/lib/saved-types";
import type { Section } from "@/lib/types";

export class SavedItemError extends Error {
  constructor(public code: SavedErrorCode, public status: number) {
    super(code);
  }
}

async function readSaved(userId: string, tx: Prisma.TransactionClient): Promise<SavedState> {
  const { plan } = await getPlanForUser(userId, new Date(), tx);
  const rows = await tx.savedItem.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { itemId: "asc" }],
    select: {
      createdAt: true,
      item: { select: {
        id: true, section: true, title: true, summary: true, url: true,
        country: true, topics: true, score: true, publishedAt: true, createdAt: true,
        source: { select: { name: true } },
      } },
    },
  });
  const limit = plan === "paid" ? 50 : 10;
  return {
    plan, limit, count: rows.length, remaining: Math.max(0, limit - rows.length),
    bookmarks: rows.map((row) => ({ itemId: row.item.id, savedAt: row.createdAt.toISOString() })),
    items: rows.map(({ item, createdAt }) => ({
      id: item.id, section: item.section as Section, title: item.title, summary: item.summary,
      url: item.url, country: item.country ?? undefined, topics: item.topics,
      score: item.score, sourceName: item.source.name,
      publishedAt: item.publishedAt.toISOString(), createdAt: item.createdAt.toISOString(),
      savedAt: createdAt.toISOString(),
    })),
  };
}

export async function getSavedItems(userId: string): Promise<SavedState> {
  // One database snapshot for the plan, count and live content.
  return prisma.$transaction((tx) => readSaved(userId, tx), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

export async function mutateSavedItem(userId: string, itemId: string, saved: boolean): Promise<SavedSnapshot> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize this user's mutations across tabs, devices and server instances.
      // READ COMMITTED sees prior saves after the row lock is acquired.
      const users = await tx.$queryRaw<SubscriptionUser[]>`
        SELECT "email", "subscriptionPlan", "subscriptionStatus",
               "subscriptionCurrentPeriodStart", "subscriptionCurrentPeriodEnd"
        FROM "User" WHERE "id" = ${userId} FOR UPDATE
      `;
      if (!users.length) throw new SavedItemError("UNAUTHORIZED", 401);
      const { plan } = planForSubscription(users[0]);
      const limit = plan === "paid" ? 50 : 10;
      let rows = await tx.savedItem.findMany({
        where: { userId }, select: { itemId: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { itemId: "asc" }],
      });

      if (saved) {
        // PUT is idempotent even when the account is at or above its current limit.
        if (!rows.some((row) => row.itemId === itemId)) {
          if (rows.length >= limit) throw new SavedItemError("SAVE_LIMIT_REACHED", 409);
          // The foreign key validates live content without an extra lookup.
          const row = await tx.savedItem.create({ data: { userId, itemId }, select: { itemId: true, createdAt: true } });
          rows = [row, ...rows];
        }
      } else {
        await tx.savedItem.deleteMany({ where: { userId, itemId } });
        rows = rows.filter((row) => row.itemId !== itemId);
      }

      // Return only bookmark identifiers and quota. The client already has the post text.
      return {
        plan, limit, count: rows.length, remaining: Math.max(0, limit - rows.length),
        bookmarks: rows.map((row) => ({ itemId: row.itemId, savedAt: row.createdAt.toISOString() })),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 15000 });
  } catch (error) {
    // The original item may be removed by retention cleanup between the read and insert.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new SavedItemError("ITEM_NOT_FOUND", 404);
    }
    throw error;
  }
}

// Keep the original response shape for tabs opened before the compact endpoint shipped.
export async function setItemSaved(userId: string, itemId: string, saved: boolean): Promise<SavedState> {
  await mutateSavedItem(userId, itemId, saved);
  return getSavedItems(userId);
}
