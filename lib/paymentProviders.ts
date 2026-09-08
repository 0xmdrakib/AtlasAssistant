export function appUrl(): string {
  return (
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

export function subscriptionPrice() {
  return {
    amount: process.env.NOWPAYMENTS_PRICE_AMOUNT || "2.99",
    currency: (process.env.NOWPAYMENTS_PRICE_CURRENCY || "usd").toLowerCase(),
  };
}
