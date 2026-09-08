import { z } from "zod";
import { getPaymentMinimum } from "@/lib/nowpayments";
import { billingError } from "@/lib/billing-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request, { params }: { params: { code: string } }) {
  try {
    const code = z.string().regex(/^(usdt|usdc)[a-z0-9]*$/).max(40).parse(params.code);
    const mode = z.enum(["fixed-user", "fixed-merchant", "floating-merchant"]).parse(new URL(req.url).searchParams.get("mode") || "fixed-user");
    return Response.json({ ok: true, limit: await getPaymentMinimum(code, mode) }, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" },
    });
  } catch (error) { return billingError(error); }
}
