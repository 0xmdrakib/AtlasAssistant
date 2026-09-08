import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { checkoutApi, type CheckoutApiError } from "../lib/checkout-client";

afterEach(() => mock.restoreAll());

test("an HTML gateway error is actionable and keeps the checkout key for a safe retry", async () => {
  mock.method(globalThis, "fetch", async () => new Response("<h1>Bad gateway</h1>", { status: 502 }));
  await assert.rejects(checkoutApi("/api/billing/checkout/crypto", { requestId: "same-order" }), (error: CheckoutApiError) => {
    assert.match(error.message, /HTTP 502/);
    assert.match(error.message, /resume this checkout/);
    assert.equal(error.definitiveFailure, false);
    assert.ok(!error.message.includes("<h1>"));
    return true;
  });
});

test("structured checkout rejections preserve the useful provider explanation", async () => {
  mock.method(globalThis, "fetch", async () => Response.json({ ok: false, code: "BELOW_NETWORK_MINIMUM", error: "Choose another network." }, { status: 400 }));
  await assert.rejects(checkoutApi("/api/billing/checkout/crypto", {}), (error: CheckoutApiError) => {
    assert.equal(error.message, "Choose another network.");
    assert.equal(error.definitiveFailure, true);
    return true;
  });
});

test("a lost connection never claims payment failed or discards the order key", async () => {
  mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(checkoutApi("/api/billing/checkout/crypto", {}), (error: CheckoutApiError) => {
    assert.match(error.message, /connection was interrupted/i);
    assert.ok(!error.definitiveFailure);
    return true;
  });
});
