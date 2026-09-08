const NOWPAYMENTS_BASE = "https://api.nowpayments.io/v1";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function appUrl(): string {
  return (
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

async function nowpaymentsPost(path: string, body: any): Promise<any> {
  const res = await fetch(`${NOWPAYMENTS_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": requiredEnv("NOWPAYMENTS_API_KEY"),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`NOWPayments request failed: ${res.status} ${txt}`);
  }

  return await res.json();
}

export function subscriptionPrice() {
  return {
    amount: process.env.NOWPAYMENTS_PRICE_AMOUNT || "2.99",
    currency: (process.env.NOWPAYMENTS_PRICE_CURRENCY || "usd").toLowerCase(),
  };
}

export async function createNowpaymentsInvoice(args: {
  orderId: string;
  userEmail?: string | null;
  amount?: string | null;
  discountCode?: string | null;
  discountPercentOff?: number | null;
}) {
  const price = subscriptionPrice();
  return nowpaymentsPost("/invoice", {
    price_amount: Number(args.amount || price.amount),
    price_currency: price.currency,
    order_id: args.orderId,
    order_description: args.discountCode
      ? `Atlas Assistant monthly subscription (${args.discountPercentOff || 0}% discount: ${args.discountCode})`
      : "Atlas Assistant monthly subscription",
    ipn_callback_url: `${appUrl()}/api/webhooks/nowpayments`,
    success_url: `${appUrl()}/?billing=success`,
    cancel_url: `${appUrl()}/?billing=cancelled`,
    customer_email: args.userEmail || undefined,
    is_fixed_rate: true,
    is_fee_paid_by_user: true,
  });
}
