import { z } from "zod";
import { getPaymentMinimum } from "@/lib/nowpayments";
import { billingError } from "@/lib/billing-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(_req: Request, { params }: { params: { code: string } }) {
  try {
    const code = z.string().regex(/^(usdt|usdc)[a-z0-9]*$/).max(40).parse(params.code);
    return Response.json({ ok: true, limit: await getPaymentMinimum(code) }, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" },
    });
  } catch (error) { return billingError(error); }
}
