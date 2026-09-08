import { z } from "zod";
import { validateDiscountForUser } from "@/lib/discounts";
import { subscriptionPrice } from "@/lib/paymentProviders";
import { billingError, billingResponse, billingUser } from "@/lib/billing-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const userId = await billingUser(req);
    const { code } = z.object({ code: z.string().trim().min(1).max(80) }).parse(await req.json());
    const result = await validateDiscountForUser({ code, userId, ...subscriptionPrice() });
    if (!result.ok) return billingResponse(result, 400);
    return billingResponse({ ok: true, code: result.discount.code, percentOff: result.discount.percentOff, price: result.price });
  } catch (error) { return billingError(error); }
}
