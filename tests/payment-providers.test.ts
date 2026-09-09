import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { subscriptionPrice } from "../lib/paymentProviders";
import { assertPaymentMinimum, createNowpaymentsPayment, currenciesForAmount, getPaymentMinimum } from "../lib/nowpayments";

const envKeys = [
  "APP_BASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXTAUTH_URL",
  "NOWPAYMENTS_API_KEY",
  "NOWPAYMENTS_PRICE_AMOUNT",
  "NOWPAYMENTS_PRICE_CURRENCY",
] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  process.env.APP_BASE_URL = "https://atlas.example/";
  process.env.NOWPAYMENTS_API_KEY = "test-key-not-a-real-credential";
});

afterEach(() => {
  mock.restoreAll();
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test("crypto pricing keeps defaults and accepts configured prices", () => {
  assert.deepEqual(subscriptionPrice(), { amount: "2.99", currency: "usd" });
  process.env.NOWPAYMENTS_PRICE_AMOUNT = "4.99";
  process.env.NOWPAYMENTS_PRICE_CURRENCY = "EUR";
  assert.deepEqual(subscriptionPrice(), { amount: "4.99", currency: "eur" });
});

test("crypto checkout creates a direct payment with its callback and server-priced discount", async () => {
  const request = mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(_url, "https://api.nowpayments.io/v1/payment");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("x-api-key"), process.env.NOWPAYMENTS_API_KEY);
    assert.equal(body.price_amount, 1.5);
    assert.equal(body.price_currency, "usd");
    assert.equal(body.order_id, "test-order");
    assert.equal(body.pay_currency, "usdttrc20");
    assert.equal(body.is_fixed_rate, false);
    assert.equal(body.is_fee_paid_by_user, false);
    assert.match(body.order_description, /HALF/);
    assert.equal(body.ipn_callback_url, "https://atlas.example/api/webhooks/nowpayments");
    assert.equal(body.success_url, undefined);
    assert.equal(body.cancel_url, undefined);
    return Response.json({ payment_id: "payment-test", pay_address: "test-address", pay_amount: "1.5" });
  });

  const payment = await createNowpaymentsPayment({
    orderId: "test-order",
    currency: "usd",
    payCurrency: "usdttrc20",
    amount: "1.50",
    discountCode: "HALF",
  });
  assert.equal(payment.payment_id, "payment-test");
  assert.equal(request.mock.callCount(), 1);
});

test("crypto checkout reports provider failures", async () => {
  mock.method(globalThis, "fetch", async () => new Response("Temporarily unavailable", { status: 503 }));
  await assert.rejects(createNowpaymentsPayment({ orderId: "test-order", amount: "2.99", currency: "usd", payCurrency: "usdcbsc" }), /payment service is temporarily unavailable/i);
});

test("the actual amountTo error is a network minimum rejection, not a server outage", async () => {
  mock.method(globalThis, "fetch", async () => Response.json({ code: "BAD_REQUEST", message: "amountTo is too small" }, { status: 400 }));
  await assert.rejects(createNowpaymentsPayment({ orderId: "test-order", amount: "2.99", currency: "usd", payCurrency: "usdcbase" }), (error: any) => error.code === "BELOW_NETWORK_MINIMUM" && error.status === 400);
});

test("network minimum checks use the final price and round displayed minimums up", () => {
  const limit = { code: "usdcbase", minimum: 3.001, currency: "usd" };
  assert.throws(() => assertPaymentMinimum("2.99", limit), /at least USD 3.01/);
  assert.doesNotThrow(() => assertPaymentMinimum("3.01", limit));
  assert.throws(() => assertPaymentMinimum("0.50", { ...limit, minimum: 1 }), /at least USD 1.00/);
});

test("network choices include only verified minimums supported by the payable amount", () => {
  const networks = [
    { code: "usdcbsc", asset: "USDC", network: "BNB", label: "USDC · BNB", minimum: 1 },
    { code: "usdcbase", asset: "USDC", network: "Base", label: "USDC · Base", minimum: 3.5 },
    { code: "usdttrc20", asset: "USDT", network: "Tron", label: "USDT · Tron" },
  ];
  assert.deepEqual(currenciesForAmount(networks, "2.99").map((row) => row.code), ["usdcbsc"]);
  assert.deepEqual(currenciesForAmount(networks, "0.50"), []);
});

test("minimum checks and direct checkout use the same floating rate and merchant fees", async () => {
  const minimumModes: string[] = [];
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/merchant/coins") return Response.json({ selectedCurrencies: ["usdcbase"] });
    if (url.pathname === "/v1/full-currencies") return Response.json({ currencies: [] });
    if (url.pathname === "/v1/min-amount") {
      const fixed = url.searchParams.get("is_fixed_rate");
      const buyer = url.searchParams.get("is_fee_paid_by_user");
      minimumModes.push(`${fixed}:${buyer}`);
      assert.equal(url.searchParams.get("currency_from"), "usdcbase");
      assert.equal(url.searchParams.get("fiat_equivalent"), "usd");
      assert.equal(url.searchParams.has("currency_to"), false);
      return Response.json({ fiat_equivalent: fixed === "true" ? 8.25 : 0.016, currency_to: "false" });
    }
    assert.equal(url.pathname, "/v1/payment");
    const body = JSON.parse(String(init?.body));
    assert.equal(`${body.is_fixed_rate}:${body.is_fee_paid_by_user}`, minimumModes[0]);
    assert.equal(body.price_amount, 2.99);
    return Response.json({ payment_id: "floating-test" });
  });
  const floating = await getPaymentMinimum("usdcbase");
  assert.doesNotThrow(() => assertPaymentMinimum("2.99", floating));
  assert.equal(floating.settlementCurrency, undefined);
  await createNowpaymentsPayment({ orderId: "rate-test", amount: "2.99", currency: "usd", payCurrency: "usdcbase" });
  // Cached comparison results must never replace the checkout policy's minimum.
  const fixedUser = await getPaymentMinimum("usdcbase", "fixed-user");
  const fixedMerchant = await getPaymentMinimum("usdcbase", "fixed-merchant");
  assert.throws(() => assertPaymentMinimum("2.99", fixedUser), /at least USD 8.25/);
  assert.throws(() => assertPaymentMinimum("2.99", fixedMerchant), /at least USD 8.25/);
  assert.equal((await getPaymentMinimum("usdcbase")).minimum, 0.016);
  assert.deepEqual(minimumModes, ["false:false", "true:true", "true:false"]);
});

test("crypto checkout requires its API key before contacting the provider", async () => {
  delete process.env.NOWPAYMENTS_API_KEY;
  const request = mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(createNowpaymentsPayment({ orderId: "test-order", amount: "2.99", currency: "usd", payCurrency: "usdcbsc" }), /checkout is temporarily unavailable/i);
  assert.equal(request.mock.callCount(), 0);
});
