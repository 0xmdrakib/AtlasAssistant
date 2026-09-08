import { getSavedItems } from "@/lib/saved-items";
import { savedApiError, savedResponse, savedUserId } from "@/lib/saved-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const state = await getSavedItems(await savedUserId());
    return savedResponse({ ok: true, ...state });
  } catch (error) {
    return savedApiError(error);
  }
}
