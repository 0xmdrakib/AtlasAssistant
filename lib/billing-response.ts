import { ZodError } from "zod";
import { PaymentError } from "@/lib/payment-types";

// Provider callbacks and public pricing routes must not initialize user auth.
export function billingResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function billingError(error: unknown) {
  if (error instanceof PaymentError) return billingResponse({ ok: false, code: error.code, error: error.message }, error.status);
  if (error instanceof ZodError || error instanceof SyntaxError) return billingResponse({ ok: false, code: "INVALID_REQUEST", error: "Check your payment details and try again." }, 400);
  console.error("Billing request failed", error instanceof Error ? error.name : "Unknown error");
  return billingResponse({ ok: false, code: "CHECKOUT_UNAVAILABLE", error: "Checkout is temporarily unavailable. Please try again." }, 503);
}
