import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { resolveUserIdFromSession } from "@/lib/sessionUser";
import { PaymentError } from "@/lib/payment-types";
import { readSessionHealth } from "@/lib/session-health";
export { billingResponse, billingError } from "@/lib/billing-response";

export async function billingUser(req: Request) {
  const origin = req.headers.get("origin");
  if (req.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(req.url).origin)) throw new PaymentError("FORBIDDEN", "This request is not allowed.", 403);
  const { session, unavailable } = await readSessionHealth(() => getServerSession(authOptions));
  if (unavailable) throw new PaymentError("SESSION_UNAVAILABLE", "We could not verify your session right now. Please try again; you do not need to sign out.", 503);
  const userId = session ? await resolveUserIdFromSession(session) : null;
  if (!userId) throw new PaymentError("UNAUTHORIZED", "Sign in to continue.", 401);
  return userId;
}
