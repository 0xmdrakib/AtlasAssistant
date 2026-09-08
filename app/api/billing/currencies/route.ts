import { getPaymentCurrencies } from "@/lib/nowpayments";
import { billingError, billingResponse, billingUser } from "@/lib/billing-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await billingUser(req);
    return billingResponse({ ok: true, currencies: await getPaymentCurrencies() });
  } catch (error) { return billingError(error); }
}
