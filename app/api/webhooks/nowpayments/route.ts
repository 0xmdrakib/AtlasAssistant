import { applyPaymentUpdate } from "@/lib/checkout";
import { verifyNowpaymentsSignature } from "@/lib/nowpayments";
import { billingError, billingResponse } from "@/lib/billing-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return billingResponse({ ok: false, error: "Invalid JSON" }, 400);
  if (!verifyNowpaymentsSignature(payload, req.headers.get("x-nowpayments-sig"))) return billingResponse({ ok: false, error: "Invalid signature" }, 401);
  try {
    const result = await applyPaymentUpdate(payload, true);
    return billingResponse({ ok: true, duplicate: result.duplicate });
  } catch (error) { return billingError(error); }
}
