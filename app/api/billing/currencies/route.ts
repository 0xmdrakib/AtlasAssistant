import { getCheckoutCurrencies } from "@/lib/nowpayments";
import { billingError } from "@/lib/billing-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    // Available token networks are public pricing data, contain no account data,
    // and should not open a database session just to render the selector.
    return Response.json({ ok: true, ...await getCheckoutCurrencies() }, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (error) { return billingError(error); }
}
