import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { createNowpaymentsInvoice, subscriptionPrice } from "../lib/paymentProviders";

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

test("crypto checkout creates an invoice with payment callbacks and the discounted amount", async () => {
  const request = mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(_url, "https://api.nowpayments.io/v1/invoice");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("x-api-key"), process.env.NOWPAYMENTS_API_KEY);
    assert.equal(body.price_amount, 1.5);
    assert.equal(body.price_currency, "usd");
    assert.equal(body.order_id, "test-order");
    assert.equal(body.customer_email, "reader@example.com");
    assert.match(body.order_description, /50% discount: HALF/);
    assert.equal(body.ipn_callback_url, "https://atlas.example/api/webhooks/nowpayments");
    assert.equal(body.success_url, "https://atlas.example/?billing=success");
    assert.equal(body.cancel_url, "https://atlas.example/?billing=cancelled");
    return Response.json({ id: "invoice-test", invoice_url: "https://pay.example/invoice-test" });
  });

  const invoice = await createNowpaymentsInvoice({
    orderId: "test-order",
    userEmail: "reader@example.com",
    amount: "1.50",
    discountCode: "HALF",
    discountPercentOff: 50,
  });
  assert.equal(invoice.id, "invoice-test");
  assert.equal(request.mock.callCount(), 1);
});

test("crypto checkout reports provider failures", async () => {
  mock.method(globalThis, "fetch", async () => new Response("Temporarily unavailable", { status: 503 }));
  await assert.rejects(createNowpaymentsInvoice({ orderId: "test-order" }), /NOWPayments request failed: 503/);
});

test("crypto checkout requires its API key before contacting the provider", async () => {
  delete process.env.NOWPAYMENTS_API_KEY;
  const request = mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(createNowpaymentsInvoice({ orderId: "test-order" }), /Missing required env var: NOWPAYMENTS_API_KEY/);
  assert.equal(request.mock.callCount(), 0);
});
