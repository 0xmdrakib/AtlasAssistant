export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ensureTranslationEntitlement } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { SECTIONS, type Section } from "@/lib/types";
import { getPublicFeed, queryPublicFeed } from "@/lib/public-feed";
import { resolveUserIdFromSession } from "@/lib/sessionUser";
import { isTranslateEnabled, translateItemBatch } from "@/lib/translateProvider";



function translateSingleFlightMap(): Map<string, Promise<void>> {
  const g = globalThis as any;
  if (!g.__atlasTranslateSingleFlight) g.__atlasTranslateSingleFlight = new Map();
  return g.__atlasTranslateSingleFlight as Map<string, Promise<void>>;
}


const ALLOWED_SECTIONS = new Set<Section>(SECTIONS);

function normalizeSection(input: string | null): Section | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  if (ALLOWED_SECTIONS.has(v as Section)) return v as Section;
  return null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const lang = (url.searchParams.get("lang") || "en").trim().toLowerCase();
  const section = normalizeSection(url.searchParams.get("section"));
  if (url.searchParams.has("section") && !section) {
    return Response.json({ error: "Unknown section" }, { status: 400 });
  }
  const rawDays = Number(url.searchParams.get("days") || "1");
  const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(30, Math.floor(rawDays))) : 1;
  const fresh = url.searchParams.get("fresh") === "1";
  const payload = await (fresh ? queryPublicFeed : getPublicFeed)(section, days);
  if (lang === "en") {
    return Response.json(payload, { headers: fresh ? { "Cache-Control": "no-store" } : {
      "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=30",
      "Vercel-CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=30",
    } });
  }
  const items = payload.items;

  async function attachAiSummaries(list: typeof items, lang: string) {
    const ids = list.map((i) => i.id);
    if (ids.length === 0) return list;

    const trs = await prisma.itemTranslation
      .findMany({
        where: { itemId: { in: ids }, lang },
        select: { itemId: true, aiSummary: true },
      })
      .catch(() => [] as { itemId: string; aiSummary: string | null }[]);

    const byId = new Map(trs.map((t) => [t.itemId, t.aiSummary ?? undefined]));
    return list.map((it) => ({ ...it, aiSummary: byId.get(it.id) ?? it.aiSummary }));
  }

  const translateEnabled = isTranslateEnabled();
  let translationAllowed = lang === "en";
  let translationBlock: any = null;

  if (lang !== "en" && translateEnabled) {
    const session = await getServerSession(authOptions);
    const userId = session ? await resolveUserIdFromSession(session) : null;
    if (!userId) {
      translationBlock = { error: "Subscription required for translation", upgradeRequired: true };
    } else {
      const entitlement = await ensureTranslationEntitlement({ userId, lang });
      if (entitlement.ok) translationAllowed = true;
      else translationBlock = { error: entitlement.error, upgradeRequired: entitlement.upgradeRequired };
    }
  }

  // Apply shared translation cache when requested.
  if (lang !== "en" && translateEnabled && translationAllowed) {
    const ids = items.map((i) => i.id);

    const existing = await prisma.itemTranslation.findMany({
      where: { itemId: { in: ids }, lang },
      select: { itemId: true, title: true, summary: true },
    });

    const byItemId = new Map(existing.map((t) => [t.itemId, t]));
    const missing = items.filter((it) => !byItemId.has(it.id));

    if (missing.length > 0) {
      const input = missing.map((m) => ({ id: m.id, title: m.title, summary: m.summary }));
      const inputById = new Map(input.map((x) => [x.id, x]));

      const missingIds = missing.map((m) => m.id).sort();
      const lockKey = `translate:${lang}:${missingIds.join(",")}`;
      const locks = translateSingleFlightMap();

      const run = async () => {
        const translated = await translateItemBatch(input, lang);

        // Only cache successful translations. If the model fails and we fall back to English,
        // we DO NOT write anything to the DB so a later request can retry.
        const toUpsert = translated.filter((t) => {
          if (!t.ok) return false;
          const src = inputById.get(t.id);
          if (!src) return false;
          const sameTitle = String(t.title ?? "").trim() === String(src.title ?? "").trim();
          const sameSummary = String(t.summary ?? "").trim() === String(src.summary ?? "").trim();
          return !(sameTitle && sameSummary);
        });

        if (toUpsert.length > 0) {
          // Upsert translations (shared cache across users).
          await prisma.$transaction(
            toUpsert.map((t) =>
              prisma.itemTranslation.upsert({
                where: { itemId_lang: { itemId: t.id, lang } },
                update: { title: t.title, summary: t.summary ?? "" },
                create: { itemId: t.id, lang, title: t.title, summary: t.summary ?? "" },
              })
            )
          );
        }

        // Refresh cache map (always). This avoids race-y partial maps.
        const again = await prisma.itemTranslation.findMany({
          where: { itemId: { in: ids }, lang },
          select: { itemId: true, title: true, summary: true },
        });
        byItemId.clear();
        for (const t of again) byItemId.set(t.itemId, t);
      };

      const existingLock = locks.get(lockKey);
      if (existingLock) {
        await existingLock;
      } else {
        const p = run().catch(() => undefined) as Promise<void>;
        locks.set(lockKey, p);
        try {
          await p;
        } finally {
          locks.delete(lockKey);
        }
      }
    }

    const withTranslations = items.map((it) => {
      const tr = byItemId.get(it.id);
      if (!tr) return it;
      return { ...it, title: tr.title, summary: tr.summary ?? it.summary };
    });

    const withAi = await attachAiSummaries(withTranslations, lang);

    return Response.json({
      items: withAi,
      meta: {
        updatedAt: new Date().toISOString(),
        translateEnabled: true,
        translationAllowed: true,
      },
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const withAi = items;

  return Response.json({
    items: withAi,
    meta: {
      updatedAt: new Date().toISOString(),
      translateEnabled,
      translationAllowed,
      translationBlocked: translationBlock,
    }
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
