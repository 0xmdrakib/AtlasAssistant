import { NextRequest } from "next/server";
import { mutateSavedItem, setItemSaved } from "@/lib/saved-items";
import { savedApiError, savedResponse, savedUserId } from "@/lib/saved-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function update(req: NextRequest, itemId: string, saved: boolean) {
  // Prevent cross-site requests from changing a signed-in user's collection.
  const origin = req.headers.get("origin");
  if (req.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== req.nextUrl.origin)) {
    return savedResponse({ ok: false, code: "FORBIDDEN" }, 403);
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(itemId)) return savedResponse({ ok: false, code: "INVALID_ITEM" }, 400);
  try {
    const mutate = req.nextUrl.searchParams.get("compact") === "1" ? mutateSavedItem : setItemSaved;
    const state = await mutate(await savedUserId(), itemId, saved);
    return savedResponse({ ok: true, ...state });
  } catch (error) {
    return savedApiError(error);
  }
}

export function PUT(req: NextRequest, { params }: { params: { itemId: string } }) {
  return update(req, params.itemId, true);
}

export function DELETE(req: NextRequest, { params }: { params: { itemId: string } }) {
  return update(req, params.itemId, false);
}
