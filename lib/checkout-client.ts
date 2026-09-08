export type CheckoutApiError = Error & { definitiveFailure?: boolean; code?: string };

export async function checkoutApi(path: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body ? "POST" : "GET", cache: path === "/api/billing/currencies" ? "default" : "no-store", signal: AbortSignal.timeout(45000),
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error("The connection was interrupted. Please try again to resume this checkout.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    const fallback = response.status === 401 ? "Your session expired. Sign in again to continue."
      : response.status === 429 ? "Too many checkout attempts. Please wait a moment and try again."
      : `Checkout could not get a response from the payment service (HTTP ${response.status}). Please try again to resume this checkout.`;
    throw Object.assign(new Error(typeof result?.error === "string" ? result.error : fallback), {
      // A gateway can replace a response after the order committed. Keep its
      // idempotency key unless our API explicitly reports a rejected request.
      definitiveFailure: result?.ok === false && typeof result?.code === "string", code: result?.code,
    });
  }
  return result;
}
