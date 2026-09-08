import { z } from "zod";
import { readPayment } from "@/lib/checkout";
import { billingError, billingResponse, billingUser } from "@/lib/billing-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const userId = await billingUser(req);
    const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).parse(params.id);
    return billingResponse({ ok: true, payment: await readPayment(userId, id) });
  } catch (error) { return billingError(error); }
}
