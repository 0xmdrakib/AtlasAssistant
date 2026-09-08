import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { resolveUserIdFromSession } from "@/lib/sessionUser";
import { PaymentError } from "@/lib/payment-types";
import { ZodError } from "zod";

export function billingResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function billingUser(req: Request) {
  const origin = req.headers.get("origin");
  if (req.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(req.url).origin)) throw new PaymentError("FORBIDDEN", "This request is not allowed.", 403);
  const session = await getServerSession(authOptions);
  const userId = session ? await resolveUserIdFromSession(session) : null;
  if (!userId) throw new PaymentError("UNAUTHORIZED", "Sign in to continue.", 401);
  return userId;
}

export function billingError(error: unknown) {
  if (error instanceof PaymentError) return billingResponse({ ok: false, code: error.code, error: error.message }, error.status);
  if (error instanceof ZodError || error instanceof SyntaxError) return billingResponse({ ok: false, code: "INVALID_REQUEST", error: "Check your payment details and try again." }, 400);
  console.error("Billing request failed", error instanceof Error ? error.name : "Unknown error");
  return billingResponse({ ok: false, code: "CHECKOUT_UNAVAILABLE", error: "Checkout is temporarily unavailable. Please try again." }, 503);
}
