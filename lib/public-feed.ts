import { unstable_cache } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SECTIONS, type ContentItem, type Section } from "@/lib/types";
import { isTranslateEnabled } from "@/lib/translateProvider";
import type { FeedPayload } from "@/lib/feed-types";

type FeedRow = Omit<ContentItem, "publishedAt" | "createdAt" | "country" | "aiSummary"> & {
  publishedAt: Date; createdAt: Date; country: string | null; aiSummary: string | null;
};

// One database round trip for posts, source names and cached English AI summaries.
// This query contains public content only; translation entitlement stays outside the cache.
export async function queryPublicFeed(section: Section | null, days: number): Promise<FeedPayload> {
  const cutoff = new Date(Date.now() - days * 86400000);
  const rows = await prisma.$queryRaw<FeedRow[]>(Prisma.sql`
    SELECT i."id", i."section", i."title", i."summary", i."url", i."country",
      i."topics", i."score", i."publishedAt", i."createdAt", s."name" AS "sourceName",
      COALESCE(tr."aiSummary", i."aiSummary") AS "aiSummary"
    FROM "Item" i
    JOIN "Source" s ON s."id" = i."sourceId"
    LEFT JOIN "ItemTranslation" tr ON tr."itemId" = i."id" AND tr."lang" = 'en'
    WHERE i."createdAt" >= ${cutoff}
      AND s."type" NOT IN ('ai', 'discovery')
      AND i."section" IN (${Prisma.join(SECTIONS)})
      AND lower(s."section") NOT LIKE '%faith%'
      ${section ? Prisma.sql`AND i."section" = ${section}` : Prisma.empty}
    ORDER BY i."createdAt" DESC, i."score" DESC
    LIMIT 250
  `);
  return {
    items: rows.map((row) => ({
      ...row, aiSummary: row.aiSummary ?? undefined, country: row.country ?? undefined,
      publishedAt: row.publishedAt.toISOString(), createdAt: row.createdAt.toISOString(),
    })),
    meta: { updatedAt: new Date().toISOString(), translateEnabled: isTranslateEnabled(), translationAllowed: true },
  };
}

export const getPublicFeed = unstable_cache(queryPublicFeed, ["public-feed-v1"], {
  revalidate: 30, tags: ["atlas-feed"],
});
