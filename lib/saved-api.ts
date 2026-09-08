import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveUserIdFromSession } from "@/lib/sessionUser";
import { SavedItemError } from "@/lib/saved-items";

export function savedResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function savedUserId() {
  const userId = await resolveUserIdFromSession(await getServerSession(authOptions));
  if (!userId) throw new SavedItemError("UNAUTHORIZED", 401);
  return userId;
}

export function savedApiError(error: unknown) {
  if (error instanceof SavedItemError) return savedResponse({ ok: false, code: error.code }, error.status);
  console.error("Saved items request failed", error instanceof Error ? error.name : "Unknown error");
  return savedResponse({ ok: false, code: "SAVED_UNAVAILABLE" }, 500);
}
