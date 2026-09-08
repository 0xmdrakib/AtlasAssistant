import { z } from "zod";
import { beginCheckout } from "@/lib/checkout";
import { billingError, billingResponse, billingUser } from "@/lib/billing-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const input = z.object({ requestId: z.string().uuid(), discountCode: z.string().trim().min(1).max(80) });

export async function POST(req: Request) {
  try {
    const userId = await billingUser(req);
    const body = input.parse(await req.json());
    return billingResponse({ ok: true, payment: await beginCheckout({ userId, ...body, free: true }) });
  } catch (error) { return billingError(error); }
}
