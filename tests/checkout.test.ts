import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { createHmac, randomUUID } from "node:crypto";

const databaseUrl = process.env.SAVED_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Set SAVED_TEST_DATABASE_URL to a localhost _test database.");
const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !target.pathname.endsWith("_test")) throw new Error("Checkout tests require an isolated localhost _test database.");
process.env.DATABASE_URL = databaseUrl; process.env.DIRECT_URL = databaseUrl;
process.env.OWNER_EMAILS = ""; process.env.NOWPAYMENTS_API_KEY = "local-test-only";
process.env.NOWPAYMENTS_IPN_SECRET = "local-signature-test-only";
process.env.NOWPAYMENTS_PRICE_AMOUNT = "2.99"; process.env.NOWPAYMENTS_PRICE_CURRENCY = "usd";
const { prisma } = await import("../lib/prisma");
const { beginCheckout, applyPaymentUpdate, readPayment } = await import("../lib/checkout");
const { canonicalJson, stablecoinOptions, verifyNowpaymentsSignature } = await import("../lib/nowpayments");
const prefix = `checkout-test-${randomUUID()}`;
const users: string[] = [], codes: string[] = [];
const provider = new Map<string, any>();
let providerCreates = 0;
let failNextCreate = false;

before(() => {
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    assert.ok(url.startsWith("https://api.nowpayments.io/v1/"));
    assert.equal(new Headers(init?.headers).get("x-api-key"), "local-test-only");
    if (url.endsWith("/merchant/coins")) return Response.json({ selectedCurrencies: ["usdcbsc", "usdttrc20", "btc"] });
    if (url.endsWith("/full-currencies")) return Response.json({ currencies: ["usdcbsc", "usdttrc20", "btc", "usdterc20"] });
    if (url.includes("/min-amount?")) {
      const params = new URL(url).searchParams;
      assert.equal(params.get("is_fixed_rate"), "false");
      assert.equal(params.get("is_fee_paid_by_user"), "false");
      return Response.json({ min_amount: 1, fiat_equivalent: 1 });
    }
    if (url.endsWith("/payment") && init?.method === "POST") {
      providerCreates++;
      if (failNextCreate) { failNextCreate = false; return Response.json({ message: "temporary error" }, { status: 503 }); }
      const body = JSON.parse(String(init.body));
      assert.equal(body.price_currency, "usd");
      assert.equal(body.is_fixed_rate, false);
      assert.equal(body.is_fee_paid_by_user, false);
      assert.ok(!body.success_url && !body.invoice_url, "Native checkout must not create a redirect invoice");
      const id = `${providerCreates}`;
      const payload = { ...body, payment_id: id, payment_status: "waiting", pay_amount: String(body.price_amount), pay_address: `test-address-${id}`, actually_paid: "0", payin_extra_id: "123", expiration_estimate_date: new Date(Date.now() + 900000).toISOString() };
      provider.set(id, payload);
      return Response.json(payload);
    }
    const id = url.split("/").at(-1)!;
    assert.ok(provider.has(id), `Unexpected provider request ${url}`);
    return Response.json(provider.get(id));
  });
});

after(async () => {
  mock.restoreAll();
  const payments = await prisma.paymentSession.findMany({ where: { userId: { in: users } }, select: { orderId: true } });
  await prisma.paymentEvent.deleteMany({ where: { orderId: { in: payments.map((row) => row.orderId) } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.discountCode.deleteMany({ where: { code: { in: codes } } });
  await prisma.$disconnect();
});

async function user() { const row = await prisma.user.create({ data: { email: `${prefix}-${users.length}@example.test` } }); users.push(row.id); return row.id; }
async function checkout(userId: string, discountCode?: string) { return beginCheckout({ userId, requestId: randomUUID(), payCurrency: "usdcbsc", discountCode }); }
async function payload(id: string, status: string) {
  const row = await prisma.paymentSession.findUniqueOrThrow({ where: { id } });
  return { ...provider.get(row.nowpaymentsPaymentId!), payment_status: status, actually_paid: row.payAmount };
}
async function discount(percentOff = 50, maxRedemptions = 1) { const code = `${prefix}-${codes.length}`.toUpperCase(); codes.push(code); await prisma.discountCode.create({ data: { code, percentOff, maxRedemptions } }); return code; }
const codeIs = (code: string) => (error: any) => error.code === code;

test("currency choices include only the merchant's supported stablecoin networks", () => {
  assert.deepEqual(stablecoinOptions(["usdcbsc", "usdttrc20", "btc", "usdtfake", "usdt"], ["usdterc20"]).map((row) => row.code), ["usdcbsc", "usdttrc20"]);
});

test("valid signed callbacks are accepted and tampered signatures are rejected", () => {
  const body = { b: 2, a: { z: 3, y: 4 } };
  const sig = createHmac("sha512", process.env.NOWPAYMENTS_IPN_SECRET!).update(canonicalJson(body)).digest("hex");
  assert.equal(verifyNowpaymentsSignature(body, sig), true);
  assert.equal(verifyNowpaymentsSignature({ ...body, b: 9 }, sig), false);
  assert.equal(verifyNowpaymentsSignature(body, null), false);
  assert.equal(verifyNowpaymentsSignature(body, "0"), false);
});

test("concurrent retries share one provider payment and cannot expose another user's payment", async () => {
  const userId = await user(); const other = await user(); const requestId = randomUUID(); const before = providerCreates;
  const results = await Promise.all(Array.from({ length: 4 }, () => beginCheckout({ userId, requestId, payCurrency: "usdcbsc" })));
  assert.equal(new Set(results.map((row) => row.id)).size, 1);
  assert.equal(providerCreates - before, 1);
  const final = await readPayment(userId, results[0].id, false);
  assert.ok(final.payAddress && final.payAmount && final.payinExtraId);
  assert.equal(final.status, "waiting");
  assert.equal(final.activatedAt, null);
  await assert.rejects(readPayment(other, final.id), codeIs("PAYMENT_NOT_FOUND"));
});

test("only a full finished payment grants Pro; duplicate and out-of-order updates never extend it twice", async () => {
  const userId = await user(); const payment = await checkout(userId);
  for (const status of ["confirming", "confirmed", "sending", "partially_paid"]) {
    await applyPaymentUpdate(await payload(payment.id, status), true);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).subscriptionPlan, "free");
  }
  const finished = await payload(payment.id, "finished");
  const results = await Promise.all([applyPaymentUpdate(finished, true), applyPaymentUpdate(finished, true), applyPaymentUpdate(finished)]);
  assert.ok(results.every((result) => result.payment.activatedAt));
  const expiry = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).subscriptionCurrentPeriodEnd!.toISOString();
  await applyPaymentUpdate(await payload(payment.id, "waiting"), true);
  await applyPaymentUpdate({ ...finished, updated_at: new Date().toISOString() }, true);
  assert.equal((await readPayment(userId, payment.id, false)).status, "finished");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).subscriptionCurrentPeriodEnd!.toISOString(), expiry);
});

test("mismatched price, network, identity, address and underpayment cannot grant access or consume an event", async () => {
  const userId = await user(); const payment = await checkout(userId); const valid = await payload(payment.id, "finished");
  for (const change of [{ price_amount: 0.01 }, { price_currency: "eur" }, { pay_currency: "usdttrc20" }, { payment_id: "different" }, { pay_address: "different" }, { actually_paid: "0.01" }, { actually_paid: undefined }]) {
    await assert.rejects(applyPaymentUpdate({ ...valid, ...change }, true));
  }
  assert.equal((await readPayment(userId, payment.id, false)).activatedAt, null);
  assert.equal(await prisma.paymentEvent.count({ where: { orderId: valid.order_id } }), 0);
  await applyPaymentUpdate(valid, true); // A failed attempt must not poison the valid retry.
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).subscriptionPlan, "paid");
});

test("polling reconciles a missed webhook using provider data, never client success flags", async () => {
  const userId = await user(); const payment = await checkout(userId); const finished = await payload(payment.id, "finished");
  provider.set(finished.payment_id, finished);
  const result = await readPayment(userId, payment.id);
  assert.equal(result.status, "finished"); assert.ok(result.activatedAt);
});

test("discount cap is atomic across users, failure releases a pending claim, and free activation is idempotent", async () => {
  const sharedCode = await discount(); const first = await user(); const second = await user();
  const attempts = await Promise.allSettled([checkout(first, sharedCode), checkout(second, sharedCode)]);
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await prisma.discountCode.findUniqueOrThrow({ where: { code: sharedCode } })).redeemedCount, 1);
  const won = attempts.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<any>;
  await applyPaymentUpdate(await payload(won.value.id, "expired"), true);
  assert.equal((await prisma.discountCode.findUniqueOrThrow({ where: { code: sharedCode } })).redeemedCount, 0);
  const failCode = await discount(); const failUser = await user(); failNextCreate = true;
  await assert.rejects(checkout(failUser, failCode));
  assert.equal((await prisma.discountCode.findUniqueOrThrow({ where: { code: failCode } })).redeemedCount, 0);
  assert.ok((await checkout(failUser, failCode)).payAddress);
  const freeCode = await discount(100); const freeUser = await user(); const requestId = randomUUID(); const createsBefore = providerCreates;
  const free = await beginCheckout({ userId: freeUser, requestId, discountCode: freeCode, free: true });
  const again = await beginCheckout({ userId: freeUser, requestId, discountCode: freeCode, free: true });
  assert.equal(free.activatedAt, again.activatedAt); assert.ok(free.activatedAt);
  assert.equal(providerCreates, createsBefore);
  assert.equal((await prisma.discountCode.findUniqueOrThrow({ where: { code: freeCode } })).redeemedCount, 1);
});

test("a non-free code cannot be consumed by the free endpoint; active subscribers cannot create a charge", async () => {
  const userId = await user(); const code = await discount(50);
  await assert.rejects(beginCheckout({ userId, requestId: randomUUID(), discountCode: code, free: true }), codeIs("DISCOUNT_TYPE"));
  assert.equal((await prisma.discountCode.findUniqueOrThrow({ where: { code } })).redeemedCount, 0);
  await prisma.user.update({ where: { id: userId }, data: { subscriptionPlan: "paid", subscriptionStatus: "active", subscriptionCurrentPeriodEnd: new Date(Date.now() + 86400000) } });
  const before = providerCreates;
  await assert.rejects(checkout(userId), codeIs("ALREADY_ACTIVE"));
  assert.equal(providerCreates, before);
});
