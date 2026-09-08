import { currentPayment } from "@/lib/checkout";
import { billingError, billingResponse, billingUser } from "@/lib/billing-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    return billingResponse({ ok: true, payment: await currentPayment(await billingUser(req)) });
  } catch (error) { return billingError(error); }
}
