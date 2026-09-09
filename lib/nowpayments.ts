import crypto from "node:crypto";
import { appUrl, subscriptionPrice } from "@/lib/paymentProviders";
import { PaymentError, type PaymentCurrency, type PaymentMinimum, type PaymentRateMode } from "@/lib/payment-types";

export type ProviderPayment = Record<string, unknown>;
const BASE_URL = "https://api.nowpayments.io/v1";
// Both the minimum check and payment creation must use the same rate policy.
// NOWPayments requires fixed-rate when it collects processing fees from buyers.
export const CHECKOUT_RATE_MODE: PaymentRateMode = "floating-merchant";

function rateOptions(mode: PaymentRateMode) {
  return { is_fixed_rate: mode !== "floating-merchant", is_fee_paid_by_user: mode === "fixed-user" };
}

export async function nowpaymentsRequest(path: string, body?: Record<string, unknown>, revalidate = 0): Promise<any> {
  const key = process.env.NOWPAYMENTS_API_KEY;
  if (!key) throw new PaymentError("CHECKOUT_UNAVAILABLE", "Crypto checkout is temporarily unavailable.", 503);
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: body ? "POST" : "GET", signal: AbortSignal.timeout(15000),
      ...(!body && revalidate ? { next: { revalidate } } : { cache: "no-store" as const }),
      headers: { "Content-Type": "application/json", "x-api-key": key },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    console.error("NOWPayments request failed", { endpoint: path.split("?")[0], code: "NETWORK_TIMEOUT" });
    throw new PaymentError("PROVIDER_UNAVAILABLE", "The payment service did not respond. Please try again.", 502);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const detail = `${data?.code || ""} ${data?.message || ""}`;
    // Log only the provider's error summary, never request headers or payment data.
    const message = String(data?.message || "Non-JSON provider response").replaceAll(key, "[redacted]").slice(0, 300);
    console.error("NOWPayments request failed", { endpoint: path.split("?")[0], status: response.status, code: String(data?.code || "UNKNOWN").slice(0, 80), message });
    if (/minimal|minimal_amount|min.amount|minimum|amount(?:To|From)?\s+is\s+too\s+small/i.test(detail)) {
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
  eth: "Ethereum (ERC-20)", ethereum: "Ethereum (ERC-20)", avax: "Avalanche C-Chain", celo: "Celo", opbnb: "opBNB",
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
    const network = NETWORKS[match[2]] || (typeof explicit === "string" ? NETWORKS[explicit.toLowerCase()] || explicit : "");
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
    nowpaymentsRequest("/merchant/coins", undefined, 300), nowpaymentsRequest("/full-currencies", undefined, 300).catch(() => null),
  ]).then(([merchant, details]) => {
    const currencies = stablecoinOptions(currencyRows(merchant), currencyRows(details));
    if (!currencies.length) throw new PaymentError("NO_PAYMENT_NETWORKS", "No USDT or USDC networks are available right now. Please try again later.", 503);
    currencyCache = { currencies, until: Date.now() + 300000 };
    return currencies;
  }).finally(() => { loadingCurrencies = null; });
  return loadingCurrencies;
}

const minimumCache = new Map<string, { value: PaymentMinimum; until: number }>();
const minimumRequests = new Map<string, Promise<PaymentMinimum>>();

export function getPaymentMinimum(code: string, mode: PaymentRateMode = CHECKOUT_RATE_MODE): Promise<PaymentMinimum> {
  const currency = subscriptionPrice().currency;
  const key = `${code}:${currency}:${mode}`;
  const cached = minimumCache.get(key);
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.value);
  const pending = minimumRequests.get(key);
  if (pending) return pending;
  const request = (async () => {
    if (!(await getPaymentCurrencies()).some((row) => row.code === code)) throw new PaymentError("INVALID_NETWORK", "Choose an available payment network.");
    // Omitting currency_to lets NOWPayments use this merchant's configured
    // outcome wallet and routing, exactly as POST /payment does.
    const rate = rateOptions(mode);
    const params = new URLSearchParams({ currency_from: code, fiat_equivalent: currency, is_fixed_rate: String(rate.is_fixed_rate), is_fee_paid_by_user: String(rate.is_fee_paid_by_user) });
    const data = await nowpaymentsRequest(`/min-amount?${params}`, undefined, 60);
    let minimum = Number(data.fiat_equivalent);
    if (!(Number.isFinite(minimum) && minimum > 0) && Number(data.min_amount) > 0) {
      const estimate = await nowpaymentsRequest(`/estimate?${new URLSearchParams({ amount: String(data.min_amount), currency_from: code, currency_to: currency })}`, undefined, 60);
      minimum = Number(estimate.estimated_amount);
    }
    if (!Number.isFinite(minimum) || minimum <= 0) throw new PaymentError("MINIMUM_UNAVAILABLE", "Unable to check this network’s minimum. Please try again.", 503);
    // The provider can return the literal string "false" when no target was
    // supplied. That is not an identified settlement currency.
    const settlement = typeof data.currency_to === "string" ? data.currency_to.toLowerCase() : "";
    const value = { code, minimum, currency, ...(settlement && !["false", "null", "undefined"].includes(settlement) ? { settlementCurrency: settlement } : {}) };
    minimumCache.set(key, { value, until: Date.now() + 60000 });
    return value;
  })().finally(() => minimumRequests.delete(key));
  minimumRequests.set(key, request);
  return request;
}

export function assertPaymentMinimum(amount: string, limit: PaymentMinimum) {
  if (Number(amount) + 0.000001 < limit.minimum) throw new PaymentError("BELOW_NETWORK_MINIMUM", `This network requires at least ${limit.currency.toUpperCase()} ${(Math.ceil(limit.minimum * 100) / 100).toFixed(2)}. Choose another network or remove the discount.`);
}

export function currenciesForAmount(currencies: PaymentCurrency[], amount: string) {
  return currencies.filter((currency) => typeof currency.minimum === "number" && Number(amount) + 0.000001 >= currency.minimum);
}

export async function getCheckoutCurrencies() {
  const currencies = await getPaymentCurrencies();
  const checked: PaymentCurrency[] = [];
  let next = 0;
  let unavailable = 0;
  // Bound provider concurrency. Successful minimums are cached across requests.
  await Promise.all(Array.from({ length: Math.min(6, currencies.length) }, async () => {
    while (next < currencies.length) {
      const currency = currencies[next++];
      try { const limit = await getPaymentMinimum(currency.code); checked.push({ ...currency, minimum: limit.minimum }); }
      catch { unavailable++; }
    }
  }));
  const eligible = currenciesForAmount(checked, subscriptionPrice().amount);
  eligible.sort((a, b) => a.asset.localeCompare(b.asset) || a.network.localeCompare(b.network));
  if (!checked.length && unavailable) throw new PaymentError("MINIMUM_UNAVAILABLE", "Payment networks are temporarily unavailable. Please try again.", 503);
  return { currencies: eligible, checkedCount: checked.length, unavailableCount: unavailable };
}

export function createNowpaymentsPayment(args: { orderId: string; amount: string; currency: string; payCurrency: string; discountCode?: string | null }) {
  return nowpaymentsRequest("/payment", {
    price_amount: Number(args.amount), price_currency: args.currency, pay_currency: args.payCurrency,
    order_id: args.orderId,
    order_description: args.discountCode ? `Atlas Assistant Pro · 1 month · ${args.discountCode}` : "Atlas Assistant Pro · 1 month",
    ipn_callback_url: `${appUrl()}/api/webhooks/nowpayments`,
    ...rateOptions(CHECKOUT_RATE_MODE),
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
