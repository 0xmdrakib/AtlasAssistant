import crypto from "node:crypto";
import { appUrl } from "@/lib/paymentProviders";
import { PaymentError, type PaymentCurrency } from "@/lib/payment-types";

export type ProviderPayment = Record<string, unknown>;
const BASE_URL = "https://api.nowpayments.io/v1";

export async function nowpaymentsRequest(path: string, body?: Record<string, unknown>): Promise<any> {
  const key = process.env.NOWPAYMENTS_API_KEY;
  if (!key) throw new PaymentError("CHECKOUT_UNAVAILABLE", "Crypto checkout is temporarily unavailable.", 503);
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", "x-api-key": key },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new PaymentError("PROVIDER_UNAVAILABLE", "The payment service did not respond. Please try again.", 502);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const detail = `${data?.code || ""} ${data?.message || ""}`;
    if (/minimal|minimal_amount|min.amount|minimum/i.test(detail)) {
      throw new PaymentError("BELOW_NETWORK_MINIMUM", "This amount is below the selected network’s minimum. Choose another network or remove the discount.");
    }
    throw new PaymentError("PROVIDER_UNAVAILABLE", "The payment service is temporarily unavailable. Please try again.", 502);
  }
  return data;
}

function codeOf(value: any): string {
  return String(typeof value === "string" ? value : value?.code || value?.currency || value?.ticker || "").toLowerCase();
}

const NETWORKS: Record<string, string> = {
  erc20: "Ethereum (ERC-20)", trc20: "Tron (TRC-20)", bsc: "BNB Smart Chain (BEP-20)", bep20: "BNB Smart Chain (BEP-20)",
  matic: "Polygon", polygon: "Polygon", arb: "Arbitrum", arbitrum: "Arbitrum", op: "Optimism", optimism: "Optimism",
  sol: "Solana", solana: "Solana", avaxc: "Avalanche C-Chain", algo: "Algorand", ton: "TON", base: "Base", near: "NEAR",
};

export function stablecoinOptions(merchant: unknown[], detailed: unknown[] = []): PaymentCurrency[] {
  const details = new Map(detailed.map((row) => [codeOf(row), row as any]));
  const options = new Map<string, PaymentCurrency>();
  for (const row of merchant) {
    const code = codeOf(row);
    const match = /^(usdt|usdc)([a-z0-9]*)$/.exec(code);
    if (!match) continue;
    const detail = details.get(code) || row;
    const explicit = typeof detail === "object" ? detail?.network || detail?.network_name || detail?.chain : null;
    const network = NETWORKS[match[2]] || (typeof explicit === "string" ? explicit : "");
    if (!network) continue; // Never guess the network for a deposit address.
    const asset = match[1].toUpperCase();
    options.set(code, { code, asset, network, label: `${asset} · ${network}` });
  }
  return [...options.values()].sort((a, b) => a.asset.localeCompare(b.asset) || a.network.localeCompare(b.network));
}

let currencyCache: { currencies: PaymentCurrency[]; until: number } | null = null;
let loadingCurrencies: Promise<PaymentCurrency[]> | null = null;
function currencyRows(data: any): unknown[] {
  const rows = Array.isArray(data) ? data : data?.selectedCurrencies || data?.currencies;
  return Array.isArray(rows) ? rows : [];
}

export function getPaymentCurrencies(): Promise<PaymentCurrency[]> {
  if (currencyCache && currencyCache.until > Date.now()) return Promise.resolve(currencyCache.currencies);
  if (loadingCurrencies) return loadingCurrencies;
  loadingCurrencies = Promise.all([
    nowpaymentsRequest("/merchant/coins"), nowpaymentsRequest("/full-currencies").catch(() => null),
  ]).then(([merchant, details]) => {
    const currencies = stablecoinOptions(currencyRows(merchant), currencyRows(details));
    if (!currencies.length) throw new PaymentError("NO_PAYMENT_NETWORKS", "No USDT or USDC networks are available right now. Please try again later.", 503);
    currencyCache = { currencies, until: Date.now() + 300000 };
    return currencies;
  }).finally(() => { loadingCurrencies = null; });
  return loadingCurrencies;
}

export function createNowpaymentsPayment(args: { orderId: string; amount: string; currency: string; payCurrency: string; discountCode?: string | null }) {
  return nowpaymentsRequest("/payment", {
    price_amount: Number(args.amount), price_currency: args.currency, pay_currency: args.payCurrency,
    order_id: args.orderId,
    order_description: args.discountCode ? `Atlas Assistant Pro · 1 month · ${args.discountCode}` : "Atlas Assistant Pro · 1 month",
    ipn_callback_url: `${appUrl()}/api/webhooks/nowpayments`,
    is_fixed_rate: true, is_fee_paid_by_user: true,
  });
}

export function paymentExpiry(payload: ProviderPayment): Date | null {
  const raw = payload.expiration_estimate_date || payload.valid_until;
  const date = typeof raw === "string" ? new Date(raw) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function canonicalJson(value: any): string {
  const sort = (input: any): any => Array.isArray(input) ? input.map(sort) : input && typeof input === "object"
    ? Object.fromEntries(Object.keys(input).sort().map((key) => [key, sort(input[key])])) : input;
  return JSON.stringify(sort(value));
}

export function verifyNowpaymentsSignature(payload: ProviderPayment, signature: string | null): boolean {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret || !signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = crypto.createHmac("sha512", secret).update(canonicalJson(payload)).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
